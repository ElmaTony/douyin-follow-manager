/** Compare two complete samples by the platform's stable account identifier. */
import fs from 'node:fs';
import path from 'node:path';
import { tierOf, visibleTimes } from './core.mjs';
import { randomUUID } from 'node:crypto';

function load(file) {
  if (!fs.existsSync(file)) throw new Error('需要两次完整的关注快照才能对比。');
  const snapshot = JSON.parse(fs.readFileSync(file,'utf8'));
  if (!Number.isFinite(Date.parse(snapshot?.exported_at)) || !snapshot.accounts ||
      typeof snapshot.accounts !== 'object' || Array.isArray(snapshot.accounts)) throw new Error('快照无效或尚无上一次采集记录');
  return snapshot;
}
const old = load('data/snapshot_previous.json'), latest = load('data/snapshot_latest.json');
if (Date.parse(old.exported_at) >= Date.parse(latest.exported_at)) throw new Error('快照时间顺序异常');
const recentPost = row => tierOf(visibleTimes(row)).last;
const day = epoch => epoch ? new Date(epoch * 1000).toISOString().slice(0,10) : '';
const table = [['变化','稳定账号标识','上次昵称','本次昵称','上次抖音号','本次抖音号','上次关注列表作品数','本次关注列表作品数','上次最近可见作品日（UTC）','本次最近可见作品日（UTC）','上次粉丝数','本次粉丝数']];
const counts = {新增:0,移出:0,改名:0,抖音号变化:0,作品数变化:0,可见作品更新:0,粉丝数变化:0,重新发布可见作品:0,进入停更观察:0,最新可见日期回退:0,列表作品数升至20部以上:0,列表作品数降至20部以下:0};
for (const sec of new Set([...Object.keys(latest.accounts),...Object.keys(old.accounts)])) {
  const a=old.accounts[sec], b=latest.accounts[sec], changes=[];
  if (!a || !b) changes.push(b ? '新增' : '移出');
  else {
    if (a.nickname !== b.nickname) changes.push('改名');
    if (String(a.douyin_id ?? '') !== String(b.douyin_id ?? '')) changes.push('抖音号变化');
    if (a.works != null && b.works != null && a.works !== b.works) changes.push('作品数变化');
    const older = recentPost(a), now = recentPost(b);
    const oldTime = Date.parse(old.exported_at)/1000, newTime = Date.parse(latest.exported_at)/1000;
    if (now > oldTime && now > older) changes.push('可见作品更新');
    const oldGap = Math.floor((oldTime-older)/86400), newGap = Math.floor((newTime-Math.max(older,now))/86400);
    if (older && oldGap>30 && now>oldTime && newGap<=30) changes.push('重新发布可见作品');
    if (older && now && oldGap<=30 && newGap>30) changes.push('进入停更观察');
    if (older && older>now) changes.push('最新可见日期回退');
    if (a.works!=null && b.works!=null) {
      if (a.works<20 && b.works>=20) changes.push('列表作品数升至20部以上');
      if (a.works>=20 && b.works<20) changes.push('列表作品数降至20部以下');
    }
    if (a.followers != null && b.followers != null && a.followers !== b.followers) changes.push('粉丝数变化');
  }
  if (!changes.length) continue;
  for (const label of changes) counts[label]++;
  table.push([changes.join('、'),sec,a?.nickname,b?.nickname,a?.douyin_id,b?.douyin_id,a?.works,b?.works,
    day(recentPost(a)),day(recentPost(b)),a?.followers,b?.followers]);
}
const quote = value => {
  let text = String(value ?? '').replace(/[\r\n\t]+/g,' ');
  if (/^\s*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"','""') + '"';
};
const target=path.resolve('data/snapshot_changes.csv'), temp=target+'.'+randomUUID()+'.tmp';
try {
  fs.writeFileSync(temp,'\uFEFF'+table.map(row=>row.map(quote).join(',')).join('\r\n'));
  fs.renameSync(temp,target);
} finally { fs.rmSync(temp,{force:true}); }
console.log(old.exported_at + ' → ' + latest.exported_at);
console.log('关注数 ' + Object.keys(old.accounts).length + ' → ' + Object.keys(latest.accounts).length);
console.log(Object.entries(counts).map(([label,n])=>label+' '+n).join('　'));
console.log('同一账号可有多项变化。明细：' + target);
