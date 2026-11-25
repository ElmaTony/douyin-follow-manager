/**
 * merge_incremental — 增量转移通用合并:
 *  用法: node scripts/merge_incremental.mjs <alt_following导出json>
 *  - 新 sec_uid -> 追加新行 (idx 续排)
 *  - 已知账号但台账已完成(alt_unfollow=done 等)且现在仍被小号关注 -> 复位(用户重新关注)
 */
import { loadLedger, saveLedger } from './lib.mjs';
import { isLedgerDone, readJson } from './core.mjs';
import fs from 'node:fs';

const IN = process.argv[2];
if (!IN) { console.error('用法: node scripts/merge_incremental.mjs <导出json>'); process.exit(1); }
const fresh = JSON.parse(fs.readFileSync(IN, 'utf8')).list;
const rows = loadLedger();
const bySec = new Map(rows.map((r) => [r.sec_uid, r]));
let nextIdx = Math.max(0, ...rows.map((r) => r.idx)) + 1;
const added = [], refollowed = [];
for (const it of fresh) {
  const known = bySec.get(it.sec_uid);
  if (known) {
    if (isLedgerDone(known)) {
      known.alt_unfollow = '';
      known.alt_unfollow_time = '';
      known.note = '发现小号重新关注, 再次取关';
      refollowed.push(`#${known.idx} ${known.nickname}(${known.douyin_id})`);
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
  added.push(`#${nextIdx - 1} ${it.nickname}(${it.unique_id || it.short_id})`);
}
saveLedger(rows);

// 登记表比对: 新增候选若命中"已取关登记表", 提醒用户(可能是误关注的从良/低作品号)
const registry = readJson('data/unfollow_registry.json')?.entries || {};
const hits = added.filter((s) => {
  const m = s.match(/#(\d+)/);
  const row = rows.find((r) => r.idx === Number(m?.[1]));
  return row && registry[row.sec_uid];
});
if (hits.length) {
  console.log(`⚠️ 命中已取关登记表 ${hits.length} 人 (确认无误再执行转移):`);
  for (const s of hits) {
    const m = s.match(/#(\d+)/);
    const row = rows.find((r) => r.idx === Number(m?.[1]));
    const e = registry[row.sec_uid];
    console.log(`  ⚠️ ${s} | ${e.unfollowed_since} 取关过 (${e.reason})`);
  }
}

console.log(`小号当前关注: ${fresh.length} 人`);
console.log(`新增待转移: ${added.length} 个`);
added.forEach((s) => console.log('  + ' + s));
console.log(`重新关注(只需再取关): ${refollowed.length} 个`);
refollowed.forEach((s) => console.log('  ↻ ' + s));
console.log(`台账总数: ${rows.length}`);
