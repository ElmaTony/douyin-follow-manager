/** Compare independently collected snapshots and flag changes for manual review. */
import { readJson, writeJson } from './core.mjs';

const snap = readJson('data/snapshot_latest.json');
if (!snap?.accounts) throw new Error('缺少关注快照');
const previous = readJson('data/snapshot_previous.json')?.accounts || {};
const ledger = readJson('data/ledger.json') || [];
const originalNames = new Map(ledger.map(row => [row.sec_uid, row.nickname]));
const topics = [
  /菜谱|食材|烘焙|烹饪|美食/g, /旅行|景区|酒店|徒步|露营/g,
  /编程|硬件|软件|评测|数码/g, /篮球|网球|跑步|训练|足球/g,
  /下单|促销|折扣|带货|团购/g, /绘画|水彩|插画|画材|素描/g,
];

function topic(captions) {
  const text = captions.join(' ');
  const counts = topics.map(pattern => [...text.matchAll(pattern)].length);
  const highest = Math.max(...counts);
  return highest >= 2 && counts.indexOf(highest) === counts.lastIndexOf(highest) ? counts.indexOf(highest) : null;
}

const out = [];
for (const [sec, a] of Object.entries(snap.accounts)) {
  const prior = previous[sec];
  const firstNick = prior?.nickname || originalNames.get(sec) || a.nickname;
  const nowNick = a.nickname;
  const renamed = Boolean(firstNick && nowNick && firstNick !== nowNick);
  const oldCaptions = prior?.captions || [], newCaptions = a.captions || [];
  const oldTopic = topic(oldCaptions), newTopic = topic(newCaptions);
  const contentShift = oldTopic !== null && newTopic !== null && oldTopic !== newTopic;
  const tier = renamed && contentShift ? 'high' : (renamed || contentShift) ? 'mid' : 'none';
  if (tier === 'none') continue;
  out.push({
    sec_uid: sec,
    nickname_now: nowNick,
    nickname_first: firstNick,
    renamed,
    douyin_id: a.douyin_id,
    works_now: a.works,
    visible_now: a.n_visible || 0,
    followers: a.followers,
    old_captions: oldCaptions.join(' ').slice(0, 120),
    new_captions: (a.captions || []).slice(0, 3),
    covers: a.covers || [],
    tier,
    content_shift: contentShift,
  });
}
out.sort((x, y) => (x.tier === 'high' ? 0 : 1) - (y.tier === 'high' ? 0 : 1) || y.followers - x.followers);
writeJson('data/suspects_latest.json', out);
const high = out.filter((x) => x.tier === 'high').length;
console.log('改名或内容变化：' + out.length + ' 个账号，其中两项都有变化 ' + high + ' 个。');
