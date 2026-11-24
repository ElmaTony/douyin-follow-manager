/**
 * read_suspect_state — 读取用户在画廊里的标记(存于 profiles/main 的 localStorage):
 *  无需用户复制粘贴, 直接读取 suspect_state_v1, 汇总 未标/取关/保留
 */
import { galleryPayload, reviewableRows } from './core.mjs';
import { launch } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const galleryUrl = 'file:///' + path.resolve(__dirname, '..', 'data', 'suspect_gallery.html').replace(/\\/g, '/');

const payload = galleryPayload(fs.readFileSync(new URL(galleryUrl), 'utf8'));
const data = reviewableRows(payload);
const m = await launch('main');
let saved;
try {
  await m.page.goto(galleryUrl, {waitUntil: 'domcontentloaded'});
  saved = await m.page.evaluate(key => typeof readMarks==='function' ? readMarks() : JSON.parse(localStorage.getItem(key) || '{}'), payload.key);
} finally {
  await m.context.close();
}
const rows = [];
const state = {};
for (const d of data) {
  const dec = saved[d.sec_uid];
  if (dec !== 'unf' && dec !== 'keep') continue;
  state[d.sec_uid] = dec;
  rows.push({dec, sec_uid:d.sec_uid, nickname:d.nickname, douyin_id:d.douyin_id, tier:d.tier});
}
const unf = rows.filter((r) => r.dec === 'unf');
const keep = rows.filter((r) => r.dec === 'keep');
console.log('===== 画廊标记读取 =====');
console.log(`已标取关 ${unf.length}:`);
for (const r of unf) console.log('  ✗', r.nickname, `(${r.douyin_id})`);
console.log(`已标保留 ${keep.length}:`);
for (const r of keep) console.log('  ✓', r.nickname, `(${r.douyin_id})`);
console.log(`候选总 ${data.length}, 未标 ${data.length - rows.length}`);
fs.writeFileSync('data/suspect_state_read.json', JSON.stringify({ read_at: new Date().toISOString(), unf, keep, raw: state }, null, 1), 'utf8');
process.exit(0);
