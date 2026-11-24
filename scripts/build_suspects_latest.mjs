/** Compare independently collected snapshots and flag changes for manual review. */
import { topicChange } from './topic-change.mjs';
import { readJson, writeJson } from './core.mjs';

const snap = readJson('data/snapshot_latest.json');
if (!snap?.accounts) throw new Error('缺少关注快照');
const previous = readJson('data/snapshot_previous.json')?.accounts || {};
const ledger = readJson('data/ledger.json') || [];
const originalNames = new Map(ledger.map(row => [row.sec_uid, row.nickname]));
const out = [];
for (const [sec, a] of Object.entries(snap.accounts)) {
  const prior = previous[sec];
  const firstNick = prior?.nickname || originalNames.get(sec) || a.nickname;
  const nowNick = a.nickname;
  const renamed = Boolean(firstNick && nowNick && firstNick.normalize('NFKC').trim() !== nowNick.normalize('NFKC').trim());
  const oldCaptions = prior?.captions || [], newCaptions = a.captions || [];
  const topic = topicChange(oldCaptions,newCaptions);
  const contentShift = Boolean(topic);
  const tier = renamed && contentShift ? 'high' : (renamed || contentShift) ? 'mid' : 'none';
  if (tier === 'none') continue;
  out.push({
    sec_uid: sec,
    nickname_now: nowNick,
    nickname_first: firstNick, recentRename: Boolean(renamed && prior?.nickname === firstNick),
    evidence: topic ? topic.label+'，前后各有 '+topic.before.length+'、'+topic.after.length+' 条不同文案' : '',
    renamed,
    douyin_id: a.douyin_id,
    works_now: a.works,
    visible_now: a.n_visible || 0,
    followers: a.followers,
    old_captions: (topic?.before || oldCaptions).slice(0,2).join(' ⏐ ').slice(0, 240),
    new_captions: (topic?.after || newCaptions).slice(0, 3),
    covers: a.covers || [],
    tier,
    content_shift: contentShift,
  });
}
out.sort((x, y) => (x.tier === 'high' ? 0 : 1) - (y.tier === 'high' ? 0 : 1) || y.followers - x.followers);
writeJson('data/suspects_latest.json', out);
const high = out.filter((x) => x.tier === 'high').length;
console.log('改名或内容变化：' + out.length + ' 个账号，其中两项都有变化 ' + high + ' 个。');
