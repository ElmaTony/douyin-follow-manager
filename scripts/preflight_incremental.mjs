/**
 * preflight_incremental — 增量转移通用前置检查:
 *  用法: node scripts/preflight_incremental.mjs [输出json路径]
 *  1) alt 登录态 + 身份核对(按本地绑定) + 导出当前关注列表 -> 输出文件 (不动台账!)
 *  2) main 登录态 + 身份核对(按本地绑定) + following_count
 * 退出码: 0=通过, 2=小号异常, 3=大号异常
 */
import { launch } from './lib.mjs';
import { isOwner, selfInfo } from './account-checks.mjs';
import { localTimeStr, writeJson } from './core.mjs';
import { COMMON, fetchFollowingList } from './douyin-api.mjs';

const OUT = process.argv[2] || 'data/alt_following_new.json';
const log = (...a) => console.log(localTimeStr(), ...a);

// ---- ALT: 身份 + 导出 ----
const a = await launch('alt');
let meA;
let list = [];
try {
  meA = await selfInfo(a, COMMON);
  if (!isOwner(meA, 'alt')) {
    log(`!! 小号身份异常: ${JSON.stringify(meA)}`);
    process.exitCode = 2;
  } else {
    log(`小号确认: ${meA.nickname} (抖音号 ${meA.short_id}), 当前关注 ${meA.following_count} 人`);
    try {
      const raw = await fetchFollowingList(a.page, meA.sec_uid, meA.following_count, {
        common: COMMON,
        pageDelayMs: () => 1200 + Math.floor(Math.random() * 1200),
        onPage: ({ pageNo, pageItems, totalLoaded, totalReported, hasMore }) => {
          log(`第 ${pageNo} 页: 本页 ${pageItems.length} 条, 累计 ${totalLoaded}/${totalReported ?? '?'}, has_more=${hasMore}`);
        },
      });
      list = raw.map((f) => ({
        nickname: f.nickname || '',
        sec_uid: f.sec_uid || '',
        short_id: f.short_id && String(f.short_id) !== '0' ? String(f.short_id) : '',
        unique_id: f.unique_id ? String(f.unique_id) : '',
        uid: f.uid ? String(f.uid) : '',
        signature: (f.signature || '').replace(/\s+/g, ' ').slice(0, 60),
        follower_count: f.follower_count ?? null,
      }));
    } catch {
      console.error('关注列表未完整导出，已停止合并');
      process.exitCode = 1;
    }
  }
} finally {
  await a.context.close().catch(() => {});
}
if (process.exitCode) process.exit(process.exitCode);

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
