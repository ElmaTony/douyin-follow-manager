import fs from 'node:fs';
import path from 'node:path';
import { galleryPayload, isLedgerDone, isLedgerHeld, isLedgerPending, isLedgerRetryable } from '../scripts/core.mjs';

import { binding, initialize } from '../scripts/local-state.mjs';

initialize();
const warnings = [];
const formatOwner = (b) => {
  if (!b?.short_id) return null;
  const id = b.douyin_id || b.short_id;
  return b.nickname ? `${b.nickname} (${id})` : id;
};
const mainOwner = formatOwner(binding('main')), altOwner = formatOwner(binding('alt'));
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
  Done: isLedgerDone(r), Held: isLedgerHeld(r), Retryable: isLedgerRetryable(r), Pending: isLedgerPending(r),
})));
const snapshot = !fs.existsSync(path.join(dir,'snapshot_latest.json')) ? null : read('关注快照', () => {
  const s = json('snapshot_latest.json');
  const date = new Date(s.exported_at);
  return {date:date.toISOString(),count:Object.keys(s.accounts).length};
});
if (fs.existsSync(path.join(dir,'.snapshot-progress.json'))) read('采集进度', () => {
  const work = json('.snapshot-progress.json');
  const age = Date.now()-Date.parse(work.exported_at);
  if (work.exported_at === snapshot?.date || !(age >= 0 && age <= 6*3600000)) return;
  const rows = Object.values(work.accounts || {});
  const parts = ['本轮已保存 '+rows.filter(a=>a.fetch==='ok').length+' / '+rows.length+' 位博主的作品采集结果'];
  if (fs.existsSync(path.join(dir,'.profile-progress.json'))) {
    const check = json('.profile-progress.json');
    if (check.exported_at === work.exported_at)
      parts.push('主页已核验 '+Object.keys(check.records || {}).length+(check.total ? ' / '+check.total : '')+' 位');
  }
  warnings.push(parts.join('，')+'。');
});
let canCompare = false;
if (snapshot && !pending && fs.existsSync(path.join(dir,'snapshot_previous.json'))) {
  canCompare = Boolean(read('上次快照',()=>{
    const previous = json('snapshot_previous.json');
    return previous?.accounts && !Array.isArray(previous.accounts) && typeof previous.accounts === 'object' &&
      Date.parse(previous.exported_at) < Date.parse(snapshot.date);
  }));
}
function readGalleryCount(filePath) {
  const buf = Buffer.alloc(1024);
  const fd = fs.openSync(filePath, 'r');
  let n = 0;
  try { n = fs.readSync(fd, buf, 0, buf.length, 0); } finally { fs.closeSync(fd); }
  const match = buf.toString('utf8', 0, n).match(/<meta name="guanxu-count" content="(\d+)">/);
  if (match) return Number(match[1]);
  return galleryPayload(fs.readFileSync(filePath, 'utf8')).data.length;
}
const galleries = {};
for (const n of ['review','stale','suspect']) galleries[n] = pending || !fs.existsSync(path.join(dir,n+'_gallery.html')) ? null : read(n+'_gallery', () =>
  readGalleryCount(path.join(dir,n+'_gallery.html')));
const report = read('最近自检', () => {
  const p = path.join(dir,'doctor_report.txt');
  if (!fs.existsSync(p)) return '尚未运行';
  const levels = fs.readFileSync(p,'utf8').trim().split(/\r?\n/).map(row => row.split('\t')[0]);
  if (!levels.every(level => ['PASS','WARN','FAIL'].includes(level))) throw new Error('自检报告格式错误');
  return ['PASS','WARN','FAIL'].map((v,i) => levels.filter(l=>l===v).length+' '+['通过','提醒','失败'][i]).join('　');
});
let refollowAlerts = 0;
const registry = read('取关登记表', () => {
  const reg = json('unfollow_registry.json');
  if (!reg || !reg.entries || typeof reg.entries !== 'object' || Array.isArray(reg.entries)) throw new Error('登记表格式错误');
  if (Array.isArray(reg.refollow_alerts) && reg.refollow_alerts.length > 0) {
    refollowAlerts = reg.refollow_alerts.length;
    warnings.push(
      '发现 ' + reg.refollow_alerts.length + ' 位已登记取关的博主重新出现在大号关注中：' +
      reg.refollow_alerts.slice(0, 4).map(x => x.current_nickname || x.nickname || x.sec_uid).join('、') +
      (reg.refollow_alerts.length > 4 ? ' 等' : '') + '。'
    );
  }
  return Object.keys(reg.entries).length;
});
console.log(JSON.stringify({mainOwner,altOwner,ledger,snapshot,canCompare,galleries,report,registry,refollowAlerts,warnings}));
