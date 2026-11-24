import { readFileSync } from 'node:fs';
import { readJson, snapshotTime, staleAtSnapshot, tierOf, visibleTimes, localDate, lowWorksUncertainty } from './core.mjs';

const asset = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
const css = asset('gallery.css');
const client = asset('gallery-client.js');
const lightbox = asset('gallery-lightbox.js');
const galleries = [
  { key: 'review_state_v2', href: 'review_gallery.html', name: '低作品审阅' },
  { key: 'stale_state_v1', href: 'stale_gallery.html', name: '停更审阅' },
  { key: 'suspect_state_v1', href: 'suspect_gallery.html', name: '改名与内容变更' },
];
const escapeHtml = (value) => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');

function addEvidence(rows, key) {
  const snap = readJson('data/snapshot_latest.json');
  if (!snap?.accounts) return false;
  const previous = readJson('data/snapshot_previous.json');
  const hasPrevious = Boolean(previous?.accounts && Number.isFinite(Date.parse(previous.exported_at)));
  const priorTime = hasPrevious ? snapshotTime(previous) : null;
  const asOf = snapshotTime(snap);
  const verified = new Map((readJson('data/ban_latest.json') || []).map(b=>[b.sec_uid,b]));
  const changes = new Set((readJson('data/suspects_latest.json') || []).map(x=>x.sec_uid));
  for (const row of rows) {
    const account = snap.accounts[row.sec_uid];
    if (!account) continue;
    const check = verified.get(row.sec_uid), banned = check?.status === 'banned';
    const old = previous?.accounts?.[row.sec_uid];
    row.changes = [];
    row.changeFacts = [];
    if (hasPrevious && !old) row.changes.push('新增关注');
    if (old) {
      const normalize = name => String(name || '').normalize('NFKC').trim();
      if (normalize(old.nickname) !== normalize(account.nickname)) row.changes.push('较上次改名');
      if (key === 'review_state_v2' && old.works != null && account.works != null && old.works !== account.works)
        {
          row.changes.push('列表作品数变化');
          row.changeFacts.push('上次至本次，关注列表作品数 '+old.works+' → '+account.works);
        }
      if (key !== 'suspect_state_v1') {
        const older = tierOf(visibleTimes(old),asOf), current = tierOf(visibleTimes(account),asOf);
        if (older.last > current.last) {
          row.changes.push(current.last ? '可见作品日期回退' : '本轮无可见日期');
          row.changeFacts.push('上次快照曾看到 '+older.dateStr+' 发布的作品，'+(current.last ? '本次最新可见日期为 '+current.dateStr : '本次未取得可见发布日期'));
        }
      }
      if (key === 'stale_state_v1' && !(check?.secret && row.group === 'unknown')) {
        const last = staleAtSnapshot(old,priorTime);
        if (last?.group !== row.group) {
          row.changes.push('活动分组变化');
          const oldGap = tierOf(visibleTimes(old),priorTime).gap;
          const was = oldGap == null ? '无可见日期' : oldGap+' 天';
          row.changeFacts.push('距最近已知发布：上次 '+was+'，本次 '+(row.gap != null ? row.gap+' 天' : '无可见日期'));
        }
      }
      if (key === 'suspect_state_v1' && row.contentShift && (old.captions || []).length &&
          JSON.stringify(old.captions) !== JSON.stringify(account.captions)) row.changes.push('文案样本变化');
    }
    if (Number.isInteger(check?.works_fresh)) row.works = check.works_fresh;
    if (check?.works_fresh != null && check.works_fresh !== account.works) {
      row.changeFacts.push('本次列表显示 '+(account.works ?? '未知')+'，主页核验 '+check.works_fresh+' 部作品');
    }
    const activity = staleAtSnapshot(account,asOf,check,old);
    const memberships = {
      review_state_v2:(check?.works_fresh ?? account.works ?? 0) < 20,
      stale_state_v1:!banned && Boolean(activity),
      suspect_state_v1:!banned && changes.has(row.sec_uid),
    };
    const notes = {review_state_v2:lowWorksUncertainty(account,check),stale_state_v1:activity?.reason};
    row.alsoIn = galleries.filter(g=>memberships[g.key] && g.key!==key)
      .map(g=>({name:g.name,href:g.href,note:notes[g.key] || ''}));
    if (Array.isArray(account.posts)) {
      row.posts = account.posts;
      row.covers = account.posts.filter(p=>p.cover).map(p=>p.cover);
    }
  }
  return hasPrevious;
}
export function buildGallery({ title, date, snapshotAt = date, data, key, rowKey, groups = [], filters, presetKeep = [], extraCount, protectedIds = [] }) {
  const hasPrevious = addEvidence(data,key);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (snapshotAt?.includes('T') && Number.isFinite(Date.parse(snapshotAt))) date = localDate(new Date(snapshotAt));
  const nav = galleries.map((g) => `<a href="${g.href}"${g.key === key ? ' aria-current="page"' : ''}>${g.name}</a>`).join('');
  const buttons = filters.map((f) => `<button type="button" data-f="${escapeHtml(f.id)}">${escapeHtml(f.label)}</button>`).join('');
  const searchHint = key === 'suspect_state_v1' ? '搜索新旧昵称、抖音号或文案' : '搜索昵称、抖音号或文案';
  const defaultOrder = groups.length ? '默认分组' : '默认排序';
  const keepSet = new Set(protectedIds);
  const permanent = data.filter(d => !d.badgeFix && keepSet.has(d.sec_uid)).length;
  const payload = JSON.stringify({ data, key, rowKey, groups, presetKeep, protectedIds, filters, snapshotAt, timeZone }).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${escapeHtml(title)} · 关注审阅</title><style>${css}</style></head>
<body>
<header class="mast"><div class="wrap mast-inner">
  <span class="brand"><i class="brandmark" aria-hidden="true"></i>关注审阅</span>
  <nav aria-label="审阅画廊">${nav}</nav>
</div></header>
<main class="wrap">
  <section class="overview" aria-labelledby="page-title"><div>
    <div class="dateline">数据快照 <time>${escapeHtml(date || '未知')}</time></div>
    <h1 id="page-title">${escapeHtml(title)}</h1>
    <p class="summary">共 <strong>${data.length}</strong> 个账号${extraCount ? '　·　' + escapeHtml(extraCount.label) + ' ' + escapeHtml(extraCount.value) : ''}${permanent ? '　·　名单保留 ' + permanent : ''}</p>
  </div><dl class="counts" aria-label="可审阅账号的标记统计">
    <div><dt><i></i>未标记</dt><dd id="cNone">0</dd></div>
    <div><dt><i></i>标记取关</dt><dd id="cUnf">0</dd></div>
    <div><dt><i></i>标记保留</dt><dd id="cKeep">0</dd></div>
  </dl></section>
  <section class="controls" aria-label="筛选与名单操作">
    <div class="actions"><label class="searchbox"><i aria-hidden="true"></i><input id="search" type="search" aria-label="${searchHint}" placeholder="${searchHint}"></label>
      <div class="tools"><button id="btnRow">打开下 5 个主页</button><button id="btnRowReset" title="重置浏览位置" aria-label="重置浏览位置">↺</button>
      <select id="exportScope" aria-label="名单导出范围" title="包含范围内可审阅账号及其标记"><option value="visible">当前结果</option><option value="all">整个画廊</option></select><button id="btnCopy" class="primary">复制决定名单</button><button id="btnDown" title="下载决定名单">下载</button></div></div>
    <div class="refine"><div id="seg" class="filters" role="group" aria-label="筛选账号">${buttons}</div>
    <div class="view-options">
      <label class="multi-only" title="新增关注或与本画廊相关的数据发生变化"><input type="checkbox" id="changedOnly" ${hasPrevious?'':'disabled'}>只看本轮变化</label>
      <label class="multi-only"><input type="checkbox" id="multiOnly">多画廊命中</label><select id="markFilter" aria-label="按审阅标记筛选"><option value="all">全部标记状态</option><option value="none">未标记</option><option value="none-no-cover">未标记 · 无封面</option><option value="unf">已标取关</option><option value="keep">已标保留</option></select>
      <select id="sortOrder" aria-label="结果排序"><option value="default">${defaultOrder}</option>${groups.length ? '<option value="oldest">停更最久优先</option>' : ''}<option value="followers">粉丝最多优先</option></select>
      <button id="undo" disabled>撤销上次标记</button>
    </div></div>
  </section>
  <div class="results"><strong id="resultCount"></strong><button id="clearFilters" type="button" hidden>清除筛选</button><button id="returnToList" type="button" hidden>返回原筛选与进度</button><span id="rowPos"></span></div>
  <div id="content"></div>
</main>
<dialog id="lb" aria-labelledby="lbWho">
  <div class="top"><strong id="lbWho"></strong><span><span id="lbZoom"></span><button id="lbClose" aria-label="关闭大图" autofocus>×</button></span></div>
  <div class="lb-review"><span id="lbReviewStatus" role="status"></span>
    <button id="lbKeep" title="标记后打开当前结果中下一个有封面的未标账号">标保留并看下一位</button>
    <button id="lbUnf" title="只写入审阅名单，标记后打开下一位有封面的未标账号">标取关并看下一位</button></div>
  <div class="view" id="lbView"><div class="runway" id="lbRunway"></div></div>
  <div class="bottom"><div class="attr"><span id="lbAttr"></span> <a id="lbWork" target="_blank" rel="noopener" hidden>打开原作 ↗</a></div><div class="navpill"><button id="lbPrev" aria-label="上一张">‹</button><span id="lbPos"></span><button id="lbNext" aria-label="下一张">›</button></div>
    <div class="tip">滚轮缩放 · 双击放大 · 拖拽平移 · ← → 切换</div></div>
</dialog>
<div id="toast" role="status" aria-live="polite"></div>
<script type="application/json" id="gallery-data">${payload}</script>
<script>'use strict';
${client}
${lightbox}
followAccountLink();</script></body></html>`;
}
