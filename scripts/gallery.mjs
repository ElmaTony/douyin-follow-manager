import { readFileSync } from 'node:fs';
import { readJson, snapshotTime, staleAtSnapshot, tierOf, visibleTimes, localDate, lowWorksUncertainty } from './core.mjs';

const asset = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
const css = asset('gallery.css');
const client = asset('gallery-client.js');
const profiles = asset('gallery-profiles.js');
const lightbox = asset('gallery-lightbox.js');
const galleries = [
  { key: 'review_state_v2', href: 'review_gallery.html', name: '低作品审阅' },
  { key: 'stale_state_v1', href: 'stale_gallery.html', name: '停更审阅' },
  { key: 'suspect_state_v1', href: 'suspect_gallery.html', name: '改名与内容变更' },
];
const escapeHtml = (value) => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');

function addEvidence(rows, key, protectedIds) {
  const snap = readJson('data/snapshot_latest.json');
  if (!snap?.accounts) throw new Error('画廊缺少关注快照');
  const previous = readJson('data/snapshot_previous.json');
  const hasPrevious = Boolean(previous?.accounts && Number.isFinite(Date.parse(previous.exported_at)));
  const priorTime = hasPrevious ? snapshotTime(previous) : null;
  const asOf = snapshotTime(snap);
  const verified = new Map((readJson('data/ban_latest.json') || []).map(b=>[b.sec_uid,b]));
  const changes = new Map((readJson('data/suspects_latest.json') || []).map(x=>[x.sec_uid,x]));
  const protectedSet = new Set(protectedIds);
  const membership = new Map(), union = [];
  for (const [sec, account] of Object.entries(snap.accounts)) {
    const check = verified.get(sec), banned = check?.status === 'banned';
    const works = check?.works_fresh ?? account.works;
    const low = works == null || works < 20;
    const activity = !banned && staleAtSnapshot(account,asOf,check,previous?.accounts?.[sec]);
    const change = !banned && changes.get(sec);
    const reasons = {};
    if (low) reasons.review_state_v2 = lowWorksUncertainty(account,check) ||
      (Number.isInteger(check?.works_fresh) ? '主页核验 ' : '关注列表 ')+works+' 部作品';
    if (activity) reasons.stale_state_v1 = activity.reason || '距最近已知发布 '+activity.gap+' 天';
    if (change) reasons.suspect_state_v1 = [change.renamed && (change.recentRename ? '上次以来改名' : '历史名称不同'),
      change.content_shift && '文案主题变化线索'].filter(Boolean).join('、');
    if (!Object.keys(reasons).length) continue;
    const lock = banned ? '异常保留' : check?.status!=='normal' ? '主页状态待核' : (low && lowWorksUncertainty(account,check)) || activity?.reason || '';
    membership.set(sec,{reasons,lock});
    if (!lock && !protectedSet.has(sec)) union.push({sec_uid:sec,nickname:account.nickname,douyin_id:account.douyin_id});
  }
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
      if (normalize(old.nickname) && normalize(account.nickname) && normalize(old.nickname) !== normalize(account.nickname)) row.changes.push('较上次改名');
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
    const entry = membership.get(row.sec_uid);
    if (!entry || !Object.hasOwn(entry.reasons,key)) throw new Error('画廊分类和快照不一致，请重新分析快照');
    row.badgeFix ||= entry.lock;
    if (key === 'review_state_v2' && entry.lock && !banned) row.uncertain = true;
    row.alsoIn = galleries.filter(g=>g.key!==key && Object.hasOwn(entry.reasons,g.key))
      .map(g=>({name:g.name,href:g.href,note:entry.reasons[g.key]}));
    if (Array.isArray(account.posts)) {
      row.posts = account.posts;
      row.covers = account.posts.filter(p=>p.cover).map(p=>p.cover);
    }
  }
  return {hasPrevious,union};
}
export function buildGallery({ title, date, snapshotAt = date, data, key, rowKey, groups = [], filters, presetKeep = [], extraCount, protectedIds = [] }) {
  const {hasPrevious,union} = addEvidence(data,key,protectedIds);
  presetKeep = readJson('data/gallery_preset_keep.json',presetKeep) || [];
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (snapshotAt?.includes('T') && Number.isFinite(Date.parse(snapshotAt))) date = localDate(new Date(snapshotAt));
  const nav = galleries.map((g) => `<a href="${g.href}"${g.key === key ? ' aria-current="page"' : ''}>${g.name}</a>`).join('');
  const buttons = filters.map((f) => `<button type="button" data-f="${escapeHtml(f.id)}">${escapeHtml(f.label)}</button>`).join('');
  const searchHint = key === 'suspect_state_v1' ? '搜索新旧昵称、抖音号或文案' : '搜索昵称、抖音号或文案';
  const defaultOrder = groups.length ? '默认分组' : '默认排序';
  const keepSet = new Set(protectedIds);
  const permanent = data.filter(d => !d.badgeFix && keepSet.has(d.sec_uid)).length;
  const receipts = Object.fromEntries(Object.entries(readJson('data/unfollow_registry.json')?.entries || {}).filter(([,e])=>e.verified_at).map(([sec,e])=>[sec,{at:e.verified_at,rev:e.review_revision}]));
  const payload = JSON.stringify({ data, union, receipts, sharedDecisions: true, key, rowKey, groups, presetKeep, protectedIds, filters, snapshotAt, timeZone }).replaceAll('<', '\\u003c');
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
      <div class="tools"><select id="batchSize" aria-label="每批主页数量"><option value="1">每次 1 位</option><option value="5" selected>每次 5 位</option></select><button id="btnRow" title="跳过本轮已打开或已复制的主页">打开下一批主页</button><button id="btnRowReset" title="从头重看当前结果，保留本轮主页记录" aria-label="从头重看当前结果">↺</button>
      <button id="openQueue" class="primary" type="button">待取关（0）</button><select id="exportScope" aria-label="名单导出范围" title="包含范围内可审阅账号及其标记"><option value="visible">当前结果</option><option value="all">整个画廊</option><option value="combined">三个画廊已标记</option></select><button id="btnCopy">复制决定名单</button><button id="btnDown" title="下载决定名单">下载</button></div></div>
    <div class="refine"><div id="seg" class="filters" role="group" aria-label="筛选账号">${buttons}</div>
    <div class="view-options"><label id="reuseSetting" class="multi-only" hidden title="单击主页或每次打开一位时共用标签页，Ctrl 或中键另开"><input type="checkbox" id="reuseProfile">复用主页标签页</label>
      <label class="multi-only" title="新增关注或与本画廊相关的数据发生变化"><input type="checkbox" id="changedOnly" ${hasPrevious?'':'disabled'}>只看本轮变化</label>
      <label class="multi-only"><input type="checkbox" id="multiOnly">多画廊命中</label><select id="markFilter" aria-label="按审阅标记筛选"><option value="all">全部标记状态</option><option value="none">未标记</option><option value="conflict" hidden>旧标记有冲突</option><option value="none-no-cover">未标记 · 无封面</option><option value="unf">已标取关</option><option value="keep">已标保留</option></select>
      <select id="sortOrder" aria-label="结果排序"><option value="default">${defaultOrder}</option>${groups.length ? '<option value="oldest">停更最久优先</option>' : ''}<option value="followers">粉丝最多优先</option></select>
      <button id="undo" disabled>撤销上次标记</button>
    </div></div>
  </section>
  <div class="results"><strong id="resultCount"></strong><button id="conflicts" type="button" hidden></button><button id="clearFilters" type="button" hidden>清除筛选</button><a id="backToSource" hidden></a><button id="returnToList" type="button" hidden>查看本画廊原列表</button><span id="exportSummary" aria-live="polite"></span><span id="linkNotice" role="status" hidden></span><span id="rowPos"></span></div>
  <div id="content"></div>
</main>
<dialog id="queue" aria-labelledby="queueTitle">
  <header><h2 id="queueTitle">核对待取关名单</h2><button id="queueClose" autofocus aria-label="关闭取关名单">关闭</button></header>
  <p id="queueHint"></p><ol id="queueRows"></ol><p id="queueMessage" role="status"></p>
  <footer><button id="queuePrevious" hidden>上批结果</button><button id="queueReturn">继续审阅</button><button id="queueConfirm" class="primary"></button></footer>
</dialog>
<dialog id="lb" aria-labelledby="lbWho">
  <div class="top"><span class="lb-author"><strong id="lbWho"></strong><a id="lbProfile" target="_blank" rel="noopener noreferrer">打开主页 ↗</a></span><span><span id="lbZoom"></span><button id="lbClose" aria-label="关闭大图" autofocus>×</button></span></div>
  <div class="lb-review"><button id="lbUndo" disabled>撤销上一笔</button><span id="lbReviewStatus" role="status"></span>
    <button id="lbSkip" title="这次预览暂跳过，保留现有标记">暂跳下一位</button><button id="lbKeep" title="标记后打开当前结果中下一个有封面的未标账号">标保留并看下一位</button>
    <button id="lbUnf" title="只写入审阅名单，标记后打开下一位有封面的未标账号">标取关并看下一位</button></div>
  <div class="view" id="lbView"><div class="runway" id="lbRunway"></div></div>
  <div class="bottom"><div class="attr"><span id="lbAttr"></span> <a id="lbWork" target="_blank" rel="noopener" hidden>打开原作 ↗</a></div><div class="navpill"><button id="lbPrev" aria-label="上一张">‹</button><span id="lbPos"></span><button id="lbNext" aria-label="下一张">›</button></div>
    <div class="tip">滚轮缩放 · 双击放大 · 拖拽平移 · ← → 切换</div></div>
</dialog>
<div id="toast" role="status" aria-live="polite"></div>
<script type="application/json" id="gallery-data">${payload}</script>
<script>'use strict';
${asset('gallery-decisions.js')}
${client}
${profiles}
${lightbox}
${asset('gallery-queue.js')}
followAccountLink();</script></body></html>`;
}
