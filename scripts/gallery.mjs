import { readFileSync } from 'node:fs';

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

export function buildGallery({ title, date, data, key, rowKey, groups = [], filters, presetKeep = [], extraCount, protectedIds = [] }) {
  const nav = galleries.map((g) => `<a href="${g.href}"${g.key === key ? ' aria-current="page"' : ''}>${g.name}</a>`).join('');
  const buttons = filters.map((f) => `<button type="button" data-f="${escapeHtml(f.id)}">${escapeHtml(f.label)}</button>`).join('');
  const keepSet = new Set(protectedIds);
  const permanent = data.filter(d => !d.badgeFix && keepSet.has(d.sec_uid)).length;
  const payload = JSON.stringify({ data, key, rowKey, groups, presetKeep, protectedIds, filters }).replaceAll('<', '\\u003c');
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
    <div class="actions"><label class="searchbox"><i aria-hidden="true"></i><input id="search" type="search" aria-label="搜索昵称或抖音号" placeholder="搜索昵称或抖音号"></label>
      <div class="tools"><button id="btnRow">打开下 5 个主页</button><button id="btnRowReset" title="重置浏览位置" aria-label="重置浏览位置">↺</button>
      <button id="btnCopy" class="primary">复制决定名单</button><button id="btnDown" title="下载决定名单">下载</button></div></div>
    <div id="seg" class="filters" role="group" aria-label="筛选账号">${buttons}</div>
  </section>
  <div class="results"><strong id="resultCount"></strong><span id="rowPos"></span></div>
  <div id="content"></div>
</main>
<dialog id="lb" aria-labelledby="lbWho">
  <div class="top"><strong id="lbWho"></strong><span><span id="lbZoom"></span><button id="lbClose" aria-label="关闭大图" autofocus>×</button></span></div>
  <div class="view" id="lbView"><div class="runway" id="lbRunway"></div></div>
  <div class="bottom"><div class="attr" id="lbAttr"></div><div class="navpill"><button id="lbPrev" aria-label="上一张">‹</button><span id="lbPos"></span><button id="lbNext" aria-label="下一张">›</button></div>
    <div class="tip">滚轮缩放 · 双击放大 · 拖拽平移 · ← → 切换</div></div>
</dialog>
<div id="toast" role="status" aria-live="polite"></div>
<script type="application/json" id="gallery-data">${payload}</script>
<script>'use strict';
${client}
${lightbox}
render();</script></body></html>`;
}
