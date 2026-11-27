/**
 * final_verify — 全量终态核验, 弹性重试版:
 *  每条记录分别在大号/小号页面上下文读 profile/other 的 follow_status,
 *  单条失败自动重载页面重试一次; 结果写 data/verify.json (兼容 finalize.mjs 格式)。
 *  退出码 0=全部读到, 1=有读不到的。
 */
import { launch, log, sleep } from './lib.mjs';
import fs from 'node:fs';
import { confirmedStatus, isOwner, selfInfo } from './account-checks.mjs';
import { isFollowingStatus, isLedgerDone, readJson, writeJson } from './core.mjs';
import { COMMON, fetchProfileOther } from './douyin-api.mjs';

const INCREMENTAL = process.argv.includes('--incremental');
const rows = JSON.parse(fs.readFileSync('data/ledger.json', 'utf8'));
const rowSig = (t) => [t.sec_uid, t.main_follow || '', t.main_follow_time || '', t.alt_unfollow || '', t.alt_unfollow_time || ''].join('|');

async function rawStatus(page, secUid) {
  const response = await fetchProfileOther(page, secUid, COMMON);
  confirmedStatus(response, secUid);
  return response;
}

async function safeStatus(page, secUid, which, allowDeleted = false) {
  try {
    return await rawStatus(page, secUid);
  } catch (e) {
    if (allowDeleted) {
      const probe = await fetchProfileOther(page, secUid, COMMON).catch(() => null);
      if (probe && probe.status_code !== 0 && /不存在|注销/.test(probe.status_msg || '')) {
        return { deleted: true, follow_status: 0 };
      }
    }
    log(`!! ${which} 读取失败(${e.message.slice(0, 40)}), 重载页面重试`);
    await page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(4000);
    try {
      return await rawStatus(page, secUid);
    } catch {
      if (allowDeleted) {
        const probe = await fetchProfileOther(page, secUid, COMMON).catch(() => null);
        if (probe && probe.status_code !== 0 && /不存在|注销/.test(probe.status_msg || '')) {
          return { deleted: true, follow_status: 0 };
        }
      }
      return null;
    }
  }
}

let m, a;
let fail = 0;
let reused = 0;
try {
  m = await launch('main');
  a = await launch('alt');
  const selfM = await selfInfo(m, COMMON);
  const selfA = await selfInfo(a, COMMON);
  if (!isOwner(selfM, 'main') || !isOwner(selfA, 'alt')) {
    throw new Error('终验账号与台账角色不符，已中止');
  }
  log(`大号: ${selfM.nickname} (${selfM.short_id}) 关注 ${selfM.following_count}`);

  const prev = INCREMENTAL ? readJson('data/verify.json') : null;
  const prevMap =
    INCREMENTAL && prev?.selfM?.sec_uid === selfM.sec_uid && prev?.selfA?.sec_uid === selfA.sec_uid && Array.isArray(prev.rows)
      ? new Map(prev.rows.map((r) => [r.idx, r]))
      : new Map();

  const out = [];
  for (const t of rows) {
    const sig = rowSig(t);
    const prevRow = prevMap.get(t.idx);
    if (INCREMENTAL && isLedgerDone(t) && prevRow?.sig === sig && isFollowingStatus(prevRow.main_status) && prevRow.alt_status === 0) {
      out.push({
        idx: t.idx,
        nickname: t.nickname,
        main_status: prevRow.main_status,
        alt_status: prevRow.alt_status,
        sig,
      });
      reused++;
      continue;
    }
    const allowDeleted = t.main_follow === 'skip_restricted';
    const sM = await safeStatus(m.page, t.sec_uid, 'main', allowDeleted);
    const sA = await safeStatus(a.page, t.sec_uid, 'alt', allowDeleted);
    if (!sM || !sA) {
      fail++;
      log(`!! #${t.idx} ${t.nickname} 状态读取失败`);
    }
    const deleted = Boolean(sM?.deleted || sA?.deleted);
    out.push({
      idx: t.idx,
      nickname: t.nickname,
      main_status: sM ? sM.follow_status : null,
      alt_status: sA ? sA.follow_status : null,
      ...(deleted ? { deleted: true } : {}),
      sig,
    });
    if (t.idx % 20 === 0) log(`进度 ${t.idx}/${rows.length}`);
    await sleep(350 + Math.floor(Math.random() * 350));
  }

  log(`小号: ${selfA.nickname} (${selfA.short_id}) 关注 ${selfA.following_count}${reused ? ` (复用已完成核验 ${reused} 条)` : ''}`);

  if (!fail) writeJson('data/verify.json', { selfM, selfA, rows: out }, 2);

  const transferred = out.filter((r) => isFollowingStatus(r.main_status) && r.alt_status === 0).length;
  const kept = out.filter((r) => r.main_status === 0 && isFollowingStatus(r.alt_status)).length;
  const odd = out.length - transferred - kept;
  log(`===== 终态: 已转移 ${transferred} | 保留小号 ${kept} | 其他 ${odd} | 读取失败 ${fail} =====`);
} finally {
  await m?.context?.close().catch(() => {});
  await a?.context?.close().catch(() => {});
}
process.exit(fail > 0 ? 1 : 0);
