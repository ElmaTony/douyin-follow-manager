/**
 * gen_suspect_gallery — 卖号/改名/转行嫌疑画廊（读 suspects_latest, 处罚号剔除）
 */
import fs from 'node:fs';
import { readJson } from './core.mjs';
import { buildGallery } from './gallery.mjs';

const all = readJson('data/suspects_latest.json');
if (!all) { console.error('缺少 suspects_latest.json, 先跑 build_suspects_latest.mjs'); process.exit(1); }
const bans = JSON.parse(fs.readFileSync('data/ban_latest.json', 'utf8'));
const banned = new Set(bans.filter((b) => b.status === 'banned').map((b) => b.sec_uid));
let pend = new Set();
try { pend = new Set((JSON.parse(fs.readFileSync('data/review_pending.json', 'utf8')).pending || []).map((p) => p.sec_uid)); } catch {}

const data = all
  .filter((x) => !banned.has(x.sec_uid))
  .map((x) => {
    const caps = (x.new_captions || []).filter(Boolean).slice(0, 2);
    const lines = [];
    if (x.renamed) lines.push({ text: `${x.nickname_first}  →  ${x.nickname_now}`, cls: 'warn' });
    if (x.old_captions) lines.push({ text: '旧文案: ' + x.old_captions.slice(0, 60) });
    if (caps.length) lines.push({ text: '新文案: ' + caps.join(' ⏐ ') });
    return {
      sec_uid: x.sec_uid, nickname: x.nickname_now, douyin_id: x.douyin_id,
      works: x.works_now, followers: x.followers,
      covers: x.covers || [], captions: x.new_captions || [],
      tags: [
        x.tier === 'high' ? '改名+内容转向' : (x.renamed ? '改名嫌疑' : '内容转向嫌疑'),
        ...(pend.has(x.sec_uid) ? ['本轮暂缓'] : []),
      ],
      noneText: '无封面(可点主页看最新内容)',
      extraLines: lines,
      tier: x.tier,
    };
  })
  .sort((a, b) => (a.tier === 'high' ? 0 : 1) - (b.tier === 'high' ? 0 : 1) || b.followers - a.followers);

const html = buildGallery({
  title: '改名与内容变更审阅',
  date: (readJson('data/snapshot_latest.json')?.exported_at || '').slice(0, 10),
  protectedIds: JSON.parse(fs.readFileSync('data/user_keep_list.json', 'utf8')).keeps.map(k => k.sec_uid),
  key: 'suspect_state_v1', rowKey: 'suspect_row_cursor',
  data,
  filters: [
    { id: 'all', label: '全部' },
    { id: 'high', label: '改名+转向' },
    { id: 'mid', label: '改名/转向' },
    { id: 'none', label: '未标' },
  ],
});
fs.writeFileSync('data/suspect_gallery.html', html, 'utf8');
console.log(`嫌疑画廊: ${data.length} 人`);
