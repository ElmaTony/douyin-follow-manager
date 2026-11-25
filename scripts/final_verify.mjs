/**
 * final_verify — 全量终态核验, 弹性重试版:
 *  每条记录分别在大号/小号页面上下文读 profile/other 的 follow_status,
 *  单条失败自动重载页面重试一次; 结果写 data/verify.json (兼容 finalize.mjs 格式)。
 *  退出码 0=全部读到, 1=有读不到的。
 */
import { launch, log, sleep } from './lib.mjs';
import fs from 'node:fs';
import { confirmedStatus, isOwner, selfInfo } from './account-checks.mjs';
import { isFollowingStatus, writeJson } from './core.mjs';
import { COMMON, fetchProfileOther } from './douyin-api.mjs';

const rows = JSON.parse(fs.readFileSync('data/ledger.json', 'utf8'));

async function rawStatus(page, secUid) {
  const response = await fetchProfileOther(page, secUid, COMMON);
  confirmedStatus(response, secUid);
  return response;
}

async function safeStatus(page, secUid, which) {
  try {
    return await rawStatus(page, secUid);
  } catch (e) {
    log(`!! ${which} 读取失败(${e.message.slice(0, 40)}), 重载页面重试`);
    await page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(4000);
    try { return await rawStatus(page, secUid); } catch { return null; }
  }
}

let m, a;
let fail = 0;
try {
  m = await launch('main');
  a = await launch('alt');
  const selfM = await selfInfo(m, COMMON);
  const selfA = await selfInfo(a, COMMON);
  if (!isOwner(selfM, 'main') || !isOwner(selfA, 'alt')) {
    throw new Error('终验账号与台账角色不符，已中止');
  }
  log(`大号: ${selfM.nickname} (${selfM.short_id}) 关注 ${selfM.following_count}`);

  const out = [];
  for (const t of rows) {
    const sM = await safeStatus(m.page, t.sec_uid, 'main');
    const sA = await safeStatus(a.page, t.sec_uid, 'alt');
    if (!sM || !sA) { fail++; log(`!! #${t.idx} ${t.nickname} 状态读取失败`); }
    out.push({
      idx: t.idx, nickname: t.nickname,
      main_status: sM ? sM.follow_status : null,
      alt_status: sA ? sA.follow_status : null,
    });
    if (t.idx % 20 === 0) log(`进度 ${t.idx}/${rows.length}`);
    await sleep(350 + Math.floor(Math.random() * 350));
  }

  log(`小号: ${selfA.nickname} (${selfA.short_id}) 关注 ${selfA.following_count}`);

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
