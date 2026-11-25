/**
 * preflight_incremental — 增量转移通用前置检查:
 *  用法: node scripts/preflight_incremental.mjs [输出json路径]
 *  1) alt 登录态 + 身份核对(按本地绑定) + 导出当前关注列表 -> 输出文件 (不动台账!)
 *  2) main 登录态 + 身份核对(按本地绑定) + following_count
 * 退出码: 0=通过, 2=小号异常, 3=大号异常
 */
import { launch, sleep } from './lib.mjs';
import { isOwner, selfInfo } from './account-checks.mjs';
import { writeJson } from './core.mjs';
import { COMMON, maxFollowingPages } from './douyin-api.mjs';

const OUT = process.argv[2] || 'data/alt_following_new.json';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---- ALT: 身份 + 导出 ----
const a = await launch('alt');
let meA;
const map = new Map();
let maxTime = '0', pageNo = 0, hasMore = true;
try {
  meA = await selfInfo(a, COMMON);
  if (!isOwner(meA, 'alt')) {
    log(`!! 小号身份异常: ${JSON.stringify(meA)}`);
    process.exitCode = 2;
  } else {
    log(`小号确认: ${meA.nickname} (抖音号 ${meA.short_id}), 当前关注 ${meA.following_count} 人`);
    const maxPages = maxFollowingPages(meA.following_count);
    while (hasMore && pageNo < maxPages) {
      pageNo++;
      const res = await a.page.evaluate(async ({ secUid, maxTime, common }) => {
        const qs = new URLSearchParams({
          ...common, sec_user_id: secUid, count: '20', max_time: String(maxTime),
          source_type: '0', offset: '0', publish_video_strategy_type: '2',
        });
        const r = await fetch('https://www.douyin.com/aweme/v1/web/user/following/list/?' + qs, {
          headers: { accept: 'application/json', referer: 'https://www.douyin.com/' }, credentials: 'include',
        });
        const d = await r.json();
        return {
          status_code: d?.status_code, total: d?.total, has_more: d?.has_more, min_time: d?.min_time, valid_list: Array.isArray(d?.followings),
          items: (d?.followings || []).map((f) => ({
            nickname: f.nickname || '', sec_uid: f.sec_uid || '',
            short_id: f.short_id && String(f.short_id) !== '0' ? String(f.short_id) : '',
            unique_id: f.unique_id ? String(f.unique_id) : '',
            uid: f.uid ? String(f.uid) : '',
            signature: (f.signature || '').replace(/\s+/g, ' ').slice(0, 60),
            follower_count: f.follower_count ?? null,
          })),
        };
      }, { secUid: meA.sec_uid, maxTime, common: COMMON });

      if (res.status_code !== 0 || !res.valid_list || ![0, 1, true, false].includes(res.has_more)) {
        log(`!! 第 ${pageNo} 页失败: [${res.status_code}]`);
        break;
      }
      for (const it of res.items) if (it.sec_uid && !map.has(it.sec_uid)) map.set(it.sec_uid, it);
      log(`第 ${pageNo} 页: 本页 ${res.items.length} 条, 累计 ${map.size}/${res.total ?? '?'}, has_more=${res.has_more}`);
      hasMore = res.has_more;
      if (hasMore) {
        if (!res.min_time || String(res.min_time) === String(maxTime)) { log('!! 游标未推进, 停止防死循环'); break; }
        maxTime = String(res.min_time);
        await sleep(1200 + Math.floor(Math.random() * 1200));
      }
    }
  }
} finally {
  await a.context.close().catch(() => {});
}
if (process.exitCode) process.exit(process.exitCode);

const list = [...map.values()];
if (hasMore || !Number.isSafeInteger(meA.following_count) || list.length !== meA.following_count) {
  console.error('关注列表未完整导出，已停止合并');
  process.exit(1);
}

// ---- MAIN: 登录态 + 身份 ----
const m = await launch('main');
let meM;
try {
  meM = await selfInfo(m, COMMON);
} finally {
  await m.context.close().catch(() => {});
}
if (!isOwner(meM, 'main')) {
  log(`!! 大号身份异常: ${JSON.stringify(meM)}`);
  process.exit(3);
}
log(`大号确认: ${meM.nickname} (抖音号 ${meM.short_id}), 当前关注 ${meM.following_count} 人`);
writeJson(OUT, { me: meA, list }, 2);
log(`导出完成: ${list.length} 人 -> ${OUT} (台账未动)`);

log('===== 前置检查全部通过 =====');
process.exit(0);
