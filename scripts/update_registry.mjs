/** 只在大号关注列表完整核验后，更新本地已取关登记表。 */
import fs from 'node:fs';
import path from 'node:path';
import { launch } from './lib.mjs';
import { isOwner, selfInfo } from './account-checks.mjs';
import { shanghaiDate, writeJson } from './core.mjs';
import { COMMON, fetchFollowingList } from './douyin-api.mjs';

const out = 'data/unfollow_registry.json';
const today = shanghaiDate();
const loadRegistry = () => (fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { entries: {} });
function validate(registry) {
  if (!registry.entries || typeof registry.entries !== 'object' || Array.isArray(registry.entries)) {
    throw new Error('登记表格式错误');
  }
}
validate(loadRegistry());

const current = new Map();
const main = await launch('main', { background: true });
try {
  const owner = await selfInfo(main, COMMON);
  if (!isOwner(owner, 'main') || !Number.isSafeInteger(owner.following_count)) throw new Error('大号身份或关注总数无法核实');
  let followings;
  try {
    followings = await fetchFollowingList(main.page, owner.sec_uid, owner.following_count, {
      common: COMMON,
      pageDelayMs: () => 800,
    });
  } catch {
    throw new Error('关注列表返回不完整，保留上次登记表');
  }
  for (const u of followings) {
    current.set(u.sec_uid, {
      sec_uid: u.sec_uid, nickname: u.nickname || '', douyin_id: u.unique_id || u.short_id || '',
      aweme_count: u.aweme_count ?? 0, follower_count: u.follower_count ?? 0,
    });
  }
} finally {
  await main.context.close().catch(() => {});
}

const history = new Map();
for (const file of fs.readdirSync('data')) {
  const match = /^main_following_(\d{4}-\d{2}-\d{2})\.json$/.exec(file);
  if (match && match[1] <= today) history.set(match[1], path.join('data', file));
}
const dates = [...history.keys()].sort();
const lastSeen = new Map();
let existingToday = [];
for (const [i, date] of dates.entries()) {
  const rows = JSON.parse(fs.readFileSync(history.get(date), 'utf8'));
  if (!Array.isArray(rows)) throw new Error('历史关注快照格式错误');
  if (date === today) existingToday = rows;
  for (const u of rows) if (u.sec_uid) lastSeen.set(u.sec_uid, { u, date, next: dates[i + 1] || today });
}
const registry = loadRegistry();
validate(registry);
for (const [sec, { u, date, next }] of lastSeen) {
  if (current.has(sec) || Object.hasOwn(registry.entries, sec)) continue;
  registry.entries[sec] = {
    nickname: u.nickname,
    douyin_id: u.douyin_id || u.unique_id || u.short_id || '',
    last_seen: date,
    unfollowed_since: next,
    reason: '完整关注列表比对：' + date + ' 仍在关注，' + next + ' 已移出',
  };
}
registry.refollow_alerts = Object.entries(registry.entries)
  .filter(([sec]) => current.has(sec))
  .map(([sec, e]) => ({ ...e, current_nickname: current.get(sec).nickname, sec_uid: sec }));
registry.updated = new Date().toISOString();

const mergedToday = new Map(existingToday.filter((u) => u?.sec_uid).map((u) => [u.sec_uid, u]));
for (const [sec, u] of current) mergedToday.set(sec, u);

writeJson(out, registry);
writeJson('data/main_following_' + today + '.json', [...mergedToday.values()]);
console.log('登记表更新完成。大号关注 ' + current.size + ' 人，登记 ' + Object.keys(registry.entries).length + ' 人，疑似重新关注 ' + registry.refollow_alerts.length + ' 人。');
