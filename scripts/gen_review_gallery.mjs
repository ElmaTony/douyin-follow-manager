/**
 * gen_review_gallery — 低作品审阅画廊（读最新快照, 作品<20）
 * 数据: snapshot_latest.json + ban_latest.json ｜ 处罚号固定保留不可标记
 */
import fs from 'node:fs';
import { readJson, lowWorksUncertainty } from './core.mjs';
import { buildGallery } from './gallery.mjs';

const snap = readJson('data/snapshot_latest.json');
if (!snap) { console.error('缺少 snapshot_latest.json'); process.exit(1); }
const bans = JSON.parse(fs.readFileSync('data/ban_latest.json', 'utf8'));
const banMap = new Map(bans.map((b) => [b.sec_uid, b]));
let preset = [];
try { preset = JSON.parse(fs.readFileSync('data/gallery_preset_keep.json', 'utf8')); } catch {}

const candidates = Object.entries(snap.accounts).filter(([sec, a]) => {
  const fresh = banMap.get(sec)?.works_fresh;
  const works = typeof fresh === 'number' ? fresh : a.works;
  return (works || 0) < 20; // 优先用 profile 接口核验过的作品数
});
const nBanned = candidates.filter(([sec]) => banMap.get(sec)?.status === 'banned').length;

const data = candidates.map(([sec, a]) => {
  const b = banMap.get(sec) || {};
  const banned = b.status === 'banned';
  const worksEff = typeof b.works_fresh === 'number' ? b.works_fresh : a.works;
  const uncertain = lowWorksUncertainty(a,b);
  const caps = (a.captions || []).slice(0, 2);
  return {
    sec_uid: sec, nickname: a.nickname, douyin_id: a.douyin_id,
    works: worksEff, followers: a.followers,
    covers: a.covers || [], captions: a.captions || [], secret: !!(b.secret || 0),
    tags: banned || uncertain ? [] : (worksEff === 0 ? ['0 作品'] : []),
    badgeFix: banned ? '异常保留' : uncertain,
    banned, uncertain:!banned && Boolean(uncertain),
    noneText: worksEff === 0 ? '无作品可见' : '封面未取到',
    extraLines: [
      ...(caps.length ? [{ text: caps.join(' ⏐ ') }] : []),
      ...(banned && b.punish_text ? [{ text: b.punish_text, cls: 'bad' }] : []),
    ],
  };
}).sort((x, y) => (x.badgeFix ? 1 : 0) - (y.badgeFix ? 1 : 0) || x.works - y.works || y.followers - x.followers);

const html = buildGallery({
  title: '低作品审阅',
  date: snap.exported_at.slice(0, 10), snapshotAt: snap.exported_at,
  protectedIds: JSON.parse(fs.readFileSync('data/user_keep_list.json', 'utf8')).keeps.map(k => k.sec_uid),
  key: 'review_state_v2', rowKey: 'review_row_cursor',
  data, presetKeep: preset,
  filters: [
    { id: 'all', label: '全部' },
    { id: 'cand', label: '取关候选' },
    { id: 'zero', label: '0 作品' },
    { id: 'few', label: '1–5 作品' },
    { id: 'some', label: '6–19 作品' },
    { id: 'banned', label: '异常·保留' },
    { id: 'uncertain', label: '资料待核' },
  ],
  extraCount: { label: '异常保留', value: nBanned },
});
fs.writeFileSync('data/review_gallery.html', html, 'utf8');
console.log(`低作品画廊: ${data.length} 张卡 (可操作前候选 ${data.filter(x=>!x.badgeFix).length} / 待核 ${data.filter(x=>x.uncertain).length}, 处罚 ${nBanned})`);
