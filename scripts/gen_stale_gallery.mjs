/**
 * gen_stale_gallery — 停更分组审阅画廊（30-90 / 90-180 / 180+，读最新快照）
 */
import fs from 'node:fs';
import { readJson, snapshotTime, staleAtSnapshot } from './core.mjs';
import { buildGallery } from './gallery.mjs';

const snap = readJson('data/snapshot_latest.json');
if (!snap) { console.error('缺少 snapshot_latest.json'); process.exit(1); }
const bans = JSON.parse(fs.readFileSync('data/ban_latest.json', 'utf8'));
const verified = new Map(bans.map(b=>[b.sec_uid,b]));
const bannedSet = new Set(bans.filter((b) => b.status === 'banned').map((b) => b.sec_uid));
const kp = JSON.parse(fs.readFileSync('data/user_keep_list.json', 'utf8'));
const pend = readJson('data/review_pending.json') || { pending: [] };
const keepSet = new Set((kp.keeps || []).map((k) => k.sec_uid));
const pendSet = new Set((pend.pending || []).map((p) => p.sec_uid));

const asOf = snapshotTime(snap);
const priorAccounts = readJson('data/snapshot_previous.json')?.accounts || {};
const GROUP_RANK = { s3090: 0, s90180: 1, s180: 2, unknown: 3 };
const data = [];
for (const [sec, a] of Object.entries(snap.accounts)) {
  if (bannedSet.has(sec)) continue;
  const activity = staleAtSnapshot(a, asOf, verified.get(sec),priorAccounts[sec]);
  if (!activity) continue;
  const { gap, group, dateStr } = activity;
  const tags = [];
  if (keepSet.has(sec)) tags.push('已标保留');
  if (pendSet.has(sec)) tags.push('本轮暂缓');
  if ((a.aigc_n || 0) > 0) tags.push(`AIGC${a.aigc_n}条`);
  data.push({
    sec_uid: sec, nickname: a.nickname, douyin_id: a.douyin_id,
    works: a.works, followers: a.followers,
    covers: a.covers || [], captions: a.captions || [],
    badgeFix: activity.reason || '', dateStr, fromHistory:activity.fromHistory,
    gap, group, tags,
    noneText: '内容不可见',
    extraLines: (a.captions || []).slice(0, 2).join(' ⏐ ') ? [{ text: (a.captions || []).slice(0, 2).join(' ⏐ ') }] : [],
  });
}
data.sort((x, y) => GROUP_RANK[x.group] - GROUP_RANK[y.group] || x.followers - y.followers);

const cnt = { s3090: 0, s90180: 0, s180: 0, unknown: 0 };
for (const d of data) cnt[d.group]++;

const html = buildGallery({
  title: '停更审阅',
  date: snap.exported_at.slice(0, 10), snapshotAt: snap.exported_at,
  protectedIds: [...keepSet],
  key: 'stale_state_v1', rowKey: 'stale_row_cursor',
  data,
  groups: [
    { id: 's3090', name: '停更 31–90 天' },
    { id: 's90180', name: '停更 91–180 天' },
    { id: 's180', name: '停更 181 天以上' },
    { id: 'unknown', name: '活动待核 · 可见信息不足' },
  ],
  filters: [
    { id: 'all', label: '全部分组' },
    { id: 's3090', label: '31–90 天' },
    { id: 's90180', label: '91–180 天' },
    { id: 's180', label: '181 天以上' },
    { id: 'unknown', label: '活动待核' },
  ],
  extraCount: { label: '已排除处罚号', value: bannedSet.size },
});
fs.writeFileSync('data/stale_gallery.html', html, 'utf8');
console.log(`停更画廊: ${data.length} 人 — 31–90 天 ${cnt.s3090} / 91–180 天 ${cnt.s90180} / 181 天以上 ${cnt.s180} / 待核 ${cnt.unknown}`);
