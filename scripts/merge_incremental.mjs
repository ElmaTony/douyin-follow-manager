/**
 * merge_incremental — 增量转移通用合并:
 *  用法: node scripts/merge_incremental.mjs <alt_following导出json>
 *  - 新 sec_uid -> 追加新行 (idx 续排)
 *  - 已知账号但台账已完成(alt_unfollow=done 等)且现在仍被小号关注 -> 复位(用户重新关注)
 */
import { loadLedger, saveLedger } from './lib.mjs';
import { isLedgerDone, normText, readJson } from './core.mjs';
import fs from 'node:fs';

const IN = process.argv[2];
if (!IN) { console.error('用法: node scripts/merge_incremental.mjs <导出json>'); process.exit(1); }
const fresh = JSON.parse(fs.readFileSync(IN, 'utf8')).list;
const rows = loadLedger();
const bySec = new Map(rows.map((r) => [r.sec_uid, r]));
const registry = readJson('data/unfollow_registry.json')?.entries || {};
let nextIdx = Math.max(0, ...rows.map((r) => r.idx)) + 1;
const addedRows = [], refollowedRows = [];
for (const it of fresh) {
  const known = bySec.get(it.sec_uid);
  if (known) {
    if (it.nickname) {
      if (known.nickname && normText(known.nickname) !== normText(it.nickname)) {
        if (!Array.isArray(known.former_nicknames)) known.former_nicknames = [];
        if (!known.former_nicknames.some((n) => normText(n) === normText(known.nickname))) {
          known.former_nicknames.push(known.nickname);
        }
      }
      known.nickname = it.nickname;
    }
    const latestId = it.unique_id || it.short_id;
    if (latestId) known.douyin_id = latestId;
    if (it.short_id && !known.legacy_short_id) known.legacy_short_id = it.short_id;
    if (it.follower_count != null) known.follower_count = it.follower_count;
    if (it.signature != null) known.signature = it.signature;
    if (isLedgerDone(known)) {
      const inRegistry = Object.hasOwn(registry, known.sec_uid);
      if (inRegistry) {
        known.main_follow = '';
        known.main_follow_time = '';
        known.fail_count = 0;
      }
      known.alt_unfollow = '';
      known.alt_unfollow_time = '';
      known.alt_fail_count = 0;
      known.note = inRegistry
        ? '发现小号重新关注(曾在大号取关登记)'
        : '发现小号重新关注, 再次核对转移';
      refollowedRows.push(known);
    }
    continue;
  }
  const row = {
    idx: nextIdx++, nickname: it.nickname, sec_uid: it.sec_uid,
    douyin_id: it.unique_id || it.short_id, legacy_short_id: it.short_id, uid: it.uid,
    profile_url: `https://www.douyin.com/user/${it.sec_uid}`,
    follower_count: it.follower_count, signature: it.signature,
    main_follow: '', main_follow_time: '', alt_unfollow: '', alt_unfollow_time: '', note: '',
  };
  rows.push(row);
  bySec.set(it.sec_uid, row);
  addedRows.push(row);
}
saveLedger(rows);

// 登记表比对: 新增或小号重关候选若命中"已取关登记表", 提醒用户
const hits = [...addedRows, ...refollowedRows].filter((r) => Object.hasOwn(registry, r.sec_uid));
if (hits.length) {
  console.log(`[WARN] ⚠️ 命中已取关登记表 ${hits.length} 人 (迁移时大号将自动拦截重新关注):`);
  for (const row of hits) {
    const e = registry[row.sec_uid];
    console.log(`  ⚠️ #${row.idx} ${row.nickname}(${row.douyin_id}) | ${e.unfollowed_since} 取关过 (${e.reason})`);
  }
}

console.log(`小号当前关注: ${fresh.length} 人`);
console.log(`新增待转移: ${addedRows.length} 个`);
addedRows.forEach((r) => console.log(`  + #${r.idx} ${r.nickname}(${r.douyin_id})`));
console.log(`重新关注(只需再取关): ${refollowedRows.length} 个`);
refollowedRows.forEach((r) => console.log(`  ↻ #${r.idx} ${r.nickname}(${r.douyin_id})`));
console.log(`台账总数: ${rows.length}`);
