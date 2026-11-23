import fs from 'node:fs';
import path from 'node:path';
import { galleryPayload } from '../scripts/core.mjs';

import { binding, initialize } from '../scripts/local-state.mjs';

initialize();
const warnings = [];
const mainOwner = binding('main')?.short_id, altOwner = binding('alt')?.short_id;
if (!mainOwner) warnings.push('首次使用请按 README 的「快速开始」绑定大号。');
const dir = 'data';
const pending = fs.existsSync(path.join(dir,'.review-ready'));
if (pending) warnings.push('上次发布中断。请点击「在线更新审阅数据」完成发布。');
const json = file => JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
function read(label, fn) {
  try { return fn(); } catch (error) { warnings.push(label + '读取失败：' + error.message.split('\n')[0]); return null; }
}
const ledger = read('迁移台账', () => json('ledger.json').map(r => ({
  Id:r.idx, Name:r.nickname, Account:r.douyin_id, Main:r.main_follow || '', Alt:r.alt_unfollow || '', Note:r.note || '',
})));
const snapshot = !fs.existsSync(path.join(dir,'snapshot_latest.json')) ? null : read('关注快照', () => {
  const s = json('snapshot_latest.json');
  const date = new Date(s.exported_at);
  return {date:date.toISOString(),count:Object.keys(s.accounts).length};
});
const galleries = {};
for (const n of ['review','stale','suspect']) galleries[n] = pending || !fs.existsSync(path.join(dir,n+'_gallery.html')) ? null : read(n+'_gallery', () =>
  galleryPayload(fs.readFileSync(path.join(dir,n+'_gallery.html'),'utf8')).data.length);
const report = read('最近自检', () => {
  const p = path.join(dir,'doctor_report.txt');
  if (!fs.existsSync(p)) return '尚未运行';
  const levels = fs.readFileSync(p,'utf8').trim().split(/\r?\n/).map(row => row.split('\t')[0]);
  if (!levels.every(level => ['PASS','WARN','FAIL'].includes(level))) throw new Error('自检报告格式错误');
  return ['PASS','WARN','FAIL'].map((v,i) => levels.filter(l=>l===v).length+' '+['通过','提醒','失败'][i]).join('　');
});
const registry = read('取关登记表', () => Object.keys(json('unfollow_registry.json').entries).length);
console.log(JSON.stringify({mainOwner,altOwner,ledger,snapshot,galleries,report,registry,warnings}));
