/**
 * prep_suspect_unfollow — 从用户标记中生成"取关"批处理清单:
 *  读 suspect_state_read.json (raw) + 当前画廊候选
 *  输出 data/batch_unfollow_suspects.csv
 */
import { csvText, galleryPayload, reviewableRows, writeTextAtomic } from './core.mjs';
import fs from 'node:fs';

const read = JSON.parse(fs.readFileSync('data/suspect_state_read.json', 'utf8'));
const all = reviewableRows(galleryPayload(fs.readFileSync('data/suspect_gallery.html', 'utf8')));
const bySec = new Map(all.map((x) => [x.sec_uid, x]));

const unf = [];
for (const [sec, dec] of Object.entries(read.raw)) {
  if (dec !== 'unf') continue;
  const d = bySec.get(sec);
  if (!d) continue;
  unf.push({ sec, nick: d.nickname, id: d.douyin_id, tier: d.tier });
}

console.log(`取关清单: ${unf.length} 人 (实锤 ${unf.filter((x) => x.tier === 'high').length} + 嫌疑 ${unf.filter((x) => x.tier === 'mid').length})`);
for (const x of unf) console.log('  ✗', x.nick, `(${x.id})`, x.tier === 'high' ? '🔴' : '');

const cols = ['序号', '昵称', '抖音号', '主页链接', 'sec_uid', '保留(填1则跳过)'];
const rows = unf.map((x, i) => [i + 1, x.nick, x.id, 'https://www.douyin.com/user/' + x.sec, x.sec, '']);
writeTextAtomic('data/batch_unfollow_suspects.csv', csvText(cols, rows));
console.log(`输出: data/batch_unfollow_suspects.csv`);
