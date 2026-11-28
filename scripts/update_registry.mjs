/** 只在大号关注列表完整核验后，更新本地已取关登记表。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './lib.mjs';
import { isOwner, selfInfo } from './account-checks.mjs';
import { readJson, shanghaiDate, writeJson } from './core.mjs';
import { COMMON, fetchFollowingList } from './douyin-api.mjs';

function validate(registry) {
  if (!registry || !registry.entries || typeof registry.entries !== 'object' || Array.isArray(registry.entries)) {
    throw new Error('登记表格式错误');
  }
}

export function readAndValidateRegistry(dataDir = 'data') {
  const out = path.join(dataDir, 'unfollow_registry.json');
  const registry = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { entries: {} };
  validate(registry);
  return { out, registry };
}

export function syncRegistryFromFollowings(followings, { dataDir = 'data', today = shanghaiDate(), maxSnapshots = 30 } = {}) {
  const { out } = readAndValidateRegistry(dataDir);
  const current = new Map();
  for (const u of followings) {
    if (!u?.sec_uid) continue;
    current.set(u.sec_uid, {
      sec_uid: u.sec_uid,
      nickname: u.nickname || '',
      douyin_id: u.douyin_id || u.unique_id || u.short_id || '',
      aweme_count: u.aweme_count ?? u.works ?? 0,
      follower_count: u.follower_count ?? u.followers ?? 0,
    });
  }

  const history = new Map();
  for (const file of fs.readdirSync(dataDir)) {
    const match = /^main_following_(\d{4}-\d{2}-\d{2})\.json$/.exec(file);
    if (match && match[1] <= today) history.set(match[1], path.join(dataDir, file));
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

  const { registry } = readAndValidateRegistry(dataDir);
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

  const keepsRaw = readJson(path.join(dataDir, 'user_keep_list.json'))?.keeps;
  const keepSet = new Set(Array.isArray(keepsRaw) ? keepsRaw.map((k) => k?.sec_uid).filter(Boolean) : []);
  registry.refollow_alerts = Object.entries(registry.entries)
    .filter(([sec]) => current.has(sec) && !keepSet.has(sec))
    .map(([sec, e]) => ({ ...e, current_nickname: current.get(sec).nickname, sec_uid: sec }));
  registry.updated = new Date().toISOString();

  const mergedToday = new Map(existingToday.filter((u) => u?.sec_uid).map((u) => [u.sec_uid, u]));
  for (const [sec, u] of current) mergedToday.set(sec, u);

  writeJson(out, registry);
  writeJson(path.join(dataDir, 'main_following_' + today + '.json'), [...mergedToday.values()]);

  const allDates = [...new Set([...dates, today])].sort();
  if (allDates.length > maxSnapshots) {
    for (const oldDate of allDates.slice(0, allDates.length - maxSnapshots)) {
      fs.rmSync(path.join(dataDir, 'main_following_' + oldDate + '.json'), { force: true });
    }
  }
  return { currentCount: current.size, entryCount: Object.keys(registry.entries).length, alertCount: registry.refollow_alerts.length };
}

export function acceptRefollows({ dataDir = 'data', ids = null } = {}) {
  const { out, registry } = readAndValidateRegistry(dataDir);
  const alerts = Array.isArray(registry.refollow_alerts) ? registry.refollow_alerts : [];
  const targets = ids === null ? new Set(alerts.map((a) => a.sec_uid).filter(Boolean)) : new Set(ids.filter(Boolean));
  let removed = 0;
  for (const sec of targets) {
    if (Object.hasOwn(registry.entries, sec)) {
      delete registry.entries[sec];
      removed++;
    }
  }
  const beforeAlerts = alerts.length;
  registry.refollow_alerts = alerts.filter((a) => !targets.has(a.sec_uid));
  if (removed > 0 || registry.refollow_alerts.length !== beforeAlerts) {
    registry.updated = new Date().toISOString();
    writeJson(out, registry);
  }
  return removed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  readAndValidateRegistry('data');
  let followings;
  const main = await launch('main', { background: true });
  try {
    const owner = await selfInfo(main, COMMON);
    if (!isOwner(owner, 'main') || !Number.isSafeInteger(owner.following_count)) throw new Error('大号身份或关注总数无法核实');
    try {
      followings = await fetchFollowingList(main.page, owner.sec_uid, owner.following_count, {
        common: COMMON,
        pageDelayMs: () => 800,
      });
    } catch {
      throw new Error('关注列表返回不完整，保留上次登记表');
    }
  } finally {
    await main.context.close().catch(() => {});
  }
  const stats = syncRegistryFromFollowings(followings, { dataDir: 'data' });
  console.log('登记表更新完成。大号关注 ' + stats.currentCount + ' 人，登记 ' + stats.entryCount + ' 人，疑似重新关注 ' + stats.alertCount + ' 人。');
}
