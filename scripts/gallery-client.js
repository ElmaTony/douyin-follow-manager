const { data: DATA, union, receipts: initialReceipts, key: KEY, rowKey: ROWKEY, groups: GROUPS, presetKeep, protectedIds, filters: FILTERS, snapshotAt, timeZone } =
  JSON.parse(document.getElementById('gallery-data').textContent);
const currentGallery = document.querySelector('nav [aria-current="page"]').getAttribute('href');
const byId = new Map(DATA.map(d => [d.sec_uid, d]));
const protectedSet = new Set(protectedIds);
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const profile = sec => 'https://www.douyin.com/user/' + encodeURIComponent(sec);
let receipts = initialReceipts || {};
const completed = sec => Date.parse(receipts[sec]?.at)>=Date.parse(snapshotAt);
const fixedLabel = d => (completed(d.sec_uid) ? '已取关登记' : '') || d.badgeFix || (protectedSet.has(d.sec_uid) ? '名单保留' : '');
const fmt = n => n >= 10000 ? (n / 10000).toFixed(1) + '万' : String(n ?? '—');

let state = readMarks();
const preset = new Set(presetKeep);
function effectiveMark(sec,stored) {
  return stored==='none' ? '' : stored || (preset.has(sec) ? 'keep' : '');
}
const markOf = sec => effectiveMark(sec,state[sec]);
let linkedAccount = false, linkedAccountId = '';
let cursor = 0;
try {
  const revisionKey = ROWKEY + ':snapshot';
  const previous = localStorage.getItem(revisionKey);
  if (previous && previous !== snapshotAt) localStorage.setItem(ROWKEY,'0');
  if (snapshotAt) localStorage.setItem(revisionKey,snapshotAt);
} catch {}
const viewKey = ROWKEY + ':view';
let filter = 'all';
function restoreView() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(viewKey));
    cursor = Math.max(0,parseInt(localStorage.getItem(ROWKEY),10) || 0);
  } catch {}
  filter = FILTERS.some(f=>f.id === saved?.filter) ? saved.filter : 'all';
  for (const id of ['sortOrder','markFilter']) {
    const select = $(id);
    select.value = [...select.options].some(o=>o.value === saved?.[id]) ? saved[id] : select.options[0].value;
  }
  $('search').value = typeof saved?.search === 'string' ? saved.search : '';
  $('multiOnly').checked = saved?.multiOnly === true;
  $('changedOnly').checked = !$('changedOnly').disabled && saved?.changedOnly === true;
}
let visible = [];
let copyingBatch = false;
const sessionKey = KEY+':review-session:'+new URL('.',location.href).href;
let savedSession;
try { savedSession = JSON.parse(sessionStorage.getItem(sessionKey)); } catch {}
if (!savedSession || savedSession.snapshot !== snapshotAt) savedSession = {snapshot:snapshotAt};
const undoKey = decisionPrefix+'undo:'+snapshotAt;
let historyStack = readHistory();
function saveSession() {
  try { sessionStorage.setItem(sessionKey,JSON.stringify(savedSession)); } catch {}
}
function updateUndo() {
  const last = latestUndo();
  for (const id of ['undo','lbUndo']) {
    $(id).disabled = !last;
    $(id).textContent = linkedAccount ? '撤销此博主标记' : id==='undo' ? '撤销上次标记' : '撤销上一笔';
    $(id).title = last ? '撤销对 '+byId.get(last.sec).nickname+' 的标记（三个画廊同步）' : '这次浏览还没有可撤销的标记';
  }
}
updateUndo();
function viewSignature() {
  return JSON.stringify([filter,$('search').value,$('markFilter').value,$('sortOrder').value,$('multiOnly').checked,$('changedOnly').checked]);
}
function rememberPosition() {
  if (linkedAccount) return;
  const limit = Math.max(document.querySelector('.mast').getBoundingClientRect().bottom,
    document.querySelector('.controls').getBoundingClientRect().bottom,0);
  const row = [...document.querySelectorAll('.card')].find(el=>el.getBoundingClientRect().bottom>limit);
  savedSession.position = {signature:viewSignature(),y:scrollY,sec:row?.dataset.sec,top:row?.getBoundingClientRect().top};
  saveSession();
}
function restorePosition() {
  const pos = savedSession.position;
  if (!pos || pos.signature!==viewSignature() || linkedAccount) return;
  const card = pos.sec && $('content').querySelector('[data-sec="'+CSS.escape(pos.sec)+'"]');
  window.scrollTo(0,card && pos.y>300 ? scrollY+card.getBoundingClientRect().top-pos.top : pos.y);
}
window.addEventListener('pagehide',rememberPosition);
const searchText = new Map(DATA.map(d => [d.sec_uid, [
  d.sec_uid, d.nickname, d.previousName, d.douyin_id, ...(d.posts || []).map(p=>p.caption), ...(d.captions || []), ...(d.extraLines || []).map(line => line.text)
].filter(Boolean).join(' ').normalize('NFKC').toLowerCase()]));
function clearAccountLink({ keepSearch = false } = {}) {
  if (!linkedAccount) return;
  if (!keepSearch && $('search').value === linkedAccountId) {
    try {
      const saved = JSON.parse(localStorage.getItem(viewKey));
      $('search').value = typeof saved?.search === 'string' ? saved.search : '';
    } catch {
      $('search').value = '';
    }
  }
  linkedAccount = false;
  linkedAccountId = '';
  $('returnToList').hidden = true;
  $('backToSource').hidden = true;
  $('linkNotice').hidden = true;
  const url = new URL(location.href);
  url.hash = '';
  history.replaceState(history.state,'',url);
}
function changeView({ keepSearch = false } = {}) {
  replayBatch = false;
  clearAccountLink({ keepSearch });
  setCursor(0);
  try { localStorage.setItem(viewKey, JSON.stringify({
    filter, changedOnly: $('changedOnly').checked, multiOnly: $('multiOnly').checked, sortOrder: $('sortOrder').value, markFilter: $('markFilter').value, search: $('search').value
  })); } catch {}
  render();
}
let toastTimer;
function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('on');
  if (typeof lbEl !== 'undefined' && lbEl?.open) $('lbReviewStatus').textContent = message;
  if ($('queue')?.open) $('queueMessage').textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('on'), 2800);
}
function setCursor(value) {
  cursor = value;
  if (linkedAccount) return;
  try { localStorage.setItem(ROWKEY, String(cursor)); } catch {}
}
function matches(d) {
  if ($('changedOnly').checked && !d.changes?.length) return false;
  if ($('multiOnly').checked && !d.alsoIn?.length) return false;
  const status = $('markFilter').value;
  const unmarkedNoCover = status === 'none-no-cover';
  if (unmarkedNoCover && d.covers?.length) return false;
  if (status !== 'all' && (fixedLabel(d) || (markOf(d.sec_uid) || 'none') !== (unmarkedNoCover ? 'none' : status))) return false;
  switch (filter) {
    case 'all': return true;
    case 'cand': return !fixedLabel(d);
    case 'few': return !fixedLabel(d) && d.works >= 1 && d.works <= 5;
    case 'some': return !fixedLabel(d) && d.works >= 6 && d.works < 20;
    case 'renamed': return d.renamed;
    case 'recentRename': return d.recentRename;
    case 'shift': return d.contentShift;
    case 'zero': return !fixedLabel(d) && d.works === 0;
    case 'banned': return d.banned;
    case 'uncertain': return d.uncertain;
    case 'high': case 'mid': return d.tier === filter;
    default: return d.group === filter;
  }
}
function counters() {
  let none = 0, keep = 0, unf = 0, conflicts = 0;
  for (const d of DATA) {
    if (fixedLabel(d)) continue;
    const mark = markOf(d.sec_uid);
    if (mark === 'keep') keep++;
    else if (mark === 'unf') unf++;
    else if (mark === 'conflict') conflicts++;
    else if (!mark) none++;
  }
  $('cNone').textContent = none;
  $('conflicts').hidden = !conflicts;
  $('conflicts').textContent = '旧标记有冲突（'+conflicts+' 位）';
  $('markFilter').querySelector('[value="conflict"]').hidden = !conflicts && $('markFilter').value!=='conflict';
  $('cKeep').textContent = keep;
  $('cUnf').textContent = unf;
}
function covers(d) {
  const srcs = (d.covers || []).slice(0, 3);
  const works = d.posts?.filter(p=>p.cover);
  if (!srcs.length) return `<div class="no-cover"><i class="frame-icon"></i>${esc(d.noneText || '暂无封面')}</div>`;
  return `<div class="covers">${srcs.map((src, i) => `<button class="cover" data-i="${i}" aria-label="查看第 ${i + 1} 张封面">
    <span class="fallback" hidden><i class="frame-icon"></i>封面暂不可用</span>
    <img loading="lazy" src="${esc(src)}" data-alternate="${esc(works?.[i]?.alternateCover || '')}" alt=""><span class="idx">${i + 1} / ${d.covers.length}</span></button>`).join('')}</div>`;
}
function workUrl(p) {
  return p && /^\d+$/.test(p.id) ? 'https://www.douyin.com/'+(p.type==='note'?'note/':'video/')+p.id : '';
}
const workCalendar = new Intl.DateTimeFormat('zh-CN',{timeZone});
function workDate(p) {
  return p.time > 1e9 && p.time < 4.1e9 ? workCalendar.format(new Date(p.time*1000)) : '';
}
function workItems(d) {
  return d.posts.map(p => {
    const url = workUrl(p), title = esc(p.caption || '无文案');
    return '<li><time>'+esc(workDate(p))+'</time> '+(url ? '<a href="'+url+'" target="_blank" rel="noopener">'+title+' ↗</a>' : title)+'</li>';
  }).join('');
}
function workList(d) {
  return d.posts?.length ? '<details class="works"><summary>近期可见作品（'+d.posts.length+'）</summary></details>' : '';

}
const galleryFiles = new Set([...document.querySelectorAll('nav a')].map(a=>a.getAttribute('href')));
function sourceTrail(params) {
  const trail=(params.get('via') || params.get('from') || '').split(',');
  return trail.every(name=>galleryFiles.has(name)) ? trail.slice(-12) : [];
}
function authorLink(file,sec,trail,rootFocused) {
  const hash=new URLSearchParams({account:sec,at:snapshotAt});
  if (trail.length) {
    hash.set('from',trail.at(-1)); hash.set('via',trail.join(','));
    if (rootFocused) hash.set('focused','1');
  }
  return file+'#'+hash;
}
let incomingTrail=[], rootFocused=false;
function card(d) {
  const locked = fixedLabel(d), mark = markOf(d.sec_uid), url = profile(d.sec_uid);
  const badges = [...(d.tags || []).filter(t => !(locked && t === '已标保留'))];
  for (const label of d.changes || []) if (!badges.includes(label)) badges.push(label);
  if (!locked && mark==='conflict') badges.push('旧标记冲突 · 请重新选择');
  if (d.secret) badges.push('私密');
  if (locked) badges.push(locked);
  const lines = d.extraLines || [];
  const detailsForCard = !locked && mark==='conflict' ? [{cls:'warn',text:conflictDetail(d.sec_uid)},...lines] : lines;
  const extras = detailsForCard.filter(x => x?.text).map(x =>
    `<p class="extra ${x.cls === 'warn' ? 'warn' : x.cls === 'bad' ? 'bad' : ''}" title="${esc(x.text)}">${esc(x.text)}</p>`).join('');
  const details = [d.works != null ? '作品 ' + esc(d.works) : '', d.followers != null ? '粉丝 ' + esc(fmt(d.followers)) : ''].filter(Boolean);
  if (d.dateStr) details.push((d.fromHistory ? '最近已知发布（上次曾看到） ' : '最近可见发布 ') + esc(d.dateStr) + '（距快照 ' + esc(d.gap) + ' 天）');
  return `<article class="card ${locked ? 'fixed' : mark === 'keep' ? 'keep' : mark === 'unf' ? 'unf' : ''}" data-sec="${esc(d.sec_uid)}">
    <div class="info"><div class="row1"><a class="nick" data-profile="${esc(d.sec_uid)}" href="${url}" target="_blank" rel="noopener">${esc(d.nickname)}</a><a class="plink" data-profile="${esc(d.sec_uid)}" href="${url}" target="_blank" rel="noopener noreferrer">${profileLabel(d.sec_uid)}</a></div>
    <div class="account-id">抖音号 ${esc(d.douyin_id || '—')}</div></div>
    ${covers(d)}
    <div class="body"><div class="meta">${details.join('　·　')}</div>
    ${badges.length ? '<div class="badges">' + badges.map(t => '<span>' + esc(t) + '</span>').join('') + '</div>' : ''}
    ${(d.changeFacts || []).map(f=>'<p class="meta">'+esc(f)+'</p>').join('')}${extras}${workList(d)}
    ${(d.alsoIn || []).map(g=>'<a class="other-gallery" href="'+esc(authorLink(g.href,d.sec_uid,[...incomingTrail,currentGallery],rootFocused))+'">'+esc(g.name)+(g.note ? ' · '+esc(g.note) : '')+' ↗</a>').join('')}</div>
    <div class="ops">${locked ? `<button class="b-lock" disabled>${esc(locked)} · 不可标记</button>` :
      `<button class="b-unf" data-mark="unf" aria-pressed="${mark === 'unf'}">待取关</button>
       <button class="b-keep" data-mark="keep" aria-pressed="${mark === 'keep'}">保留</button>
       <button class="b-reset" data-mark="none" ${mark ? '' : 'disabled'} title="移出已决定名单，回到未标记队列">移回未审</button>`}</div></article>`;
}
function render() {
  const params = new URLSearchParams(location.hash.slice(1));
  incomingTrail = linkedAccount ? sourceTrail(params) : [];
  rootFocused = linkedAccount && (!incomingTrail.length || params.get('focused')==='1');
  updateUndo();
  const query = $('search').value.trim().normalize('NFKC').toLowerCase();
  visible = DATA.filter(d => matches(d) && (linkedAccount ? d.sec_uid === $('search').value : !query || searchText.get(d.sec_uid).includes(query)));
  const order = $('sortOrder').value;
  if (order === 'oldest') visible.sort((a, b) => (b.gap ?? -1) - (a.gap ?? -1));
  if (order === 'followers') visible.sort((a,b) => (b.followers ?? -1) - (a.followers ?? -1));
  if (cursor > visible.length) setCursor(visible.length);
  const grid = rows => '<div class="grid">' + rows.map(card).join('') + '</div>';
  let html = '';
  if (linkedAccount && !byId.has($('search').value)) html='<div class="empty"><strong>当前快照中，这位博主没有命中本画廊</strong><p>可返回来源画廊，或查看本画廊原列表。</p></div>';
  else if (!DATA.length) html = '<div class="empty"><strong>这次快照没有需要在此审阅的账号</strong></div>';
  else if (!visible.length) html = '<div class="empty"><strong>没有匹配的账号</strong><p>可更换筛选条件或搜索词。</p></div>';
  else if (order === 'default' && filter === 'all' && GROUPS.length) {
    for (const group of GROUPS) {
      const rows = visible.filter(d => d.group === group.id);
      if (rows.length) html += `<div class="group"><h2>${esc(group.name)}</h2><span>${rows.length} 人 · 粉丝升序</span></div>${grid(rows)}`;
    }
  } else html = grid(visible);
  $('content').innerHTML = html;
  $('clearFilters').hidden = linkedAccount || !(query || filter !== 'all' || $('markFilter').value !== 'all' ||
    $('multiOnly').checked || $('changedOnly').checked || order !== 'default');
  updateExport();
  $('resultCount').textContent = `当前结果　${visible.length} 人`;
  document.querySelectorAll('[data-f]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f === filter)));
  counters();
  rowPos();
}
document.addEventListener('error', event => {
  const img = event.target;
  if (img.tagName !== 'IMG') return;
  if (img.dataset.alternate) {
    const url = img.dataset.alternate;
    delete img.dataset.alternate;
    img.src = url;
    return;
  }
  const fallback = img.parentElement?.querySelector('.fallback,.missing');
  if (fallback) { img.hidden = true; fallback.hidden = false; }
}, true);
$('content').addEventListener('toggle', e => {
  const details = e.target;
  if (details.matches('details.works') && details.open && !details.querySelector('ol')) {
    details.insertAdjacentHTML('beforeend','<ol>'+workItems(byId.get(details.closest('.card').dataset.sec))+'</ol>');
  }
},true);
let lastPointerDecision;
$('content').addEventListener('keydown',e=>{
  if (e.repeat && e.key==='Enter' && e.target.closest('[data-mark]')) e.preventDefault();
});
$('content').addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  const row = button.closest('.card');
  const sec = row.dataset.sec;
  if (button.classList.contains('cover')) { openLb(sec, Number(button.dataset.i)); return; }
  const mark = button.dataset.mark;
  if (!mark || event.detail>1 || fixedLabel(byId.get(sec))) return;
  if (event.detail>0) {
    const last=lastPointerDecision;
    if (last && last.sec!==sec && event.timeStamp-last.time<400 &&
        Math.hypot(event.clientX-last.x,event.clientY-last.y)<5) return;
    lastPointerDecision={sec,time:event.timeStamp,x:event.clientX,y:event.clientY};
  }
  void applyDecision(sec,mark);
});
async function applyDecision(sec,mark) {
  const seen = markOf(sec);
  return withDecisionLock(sec,()=>{
    const previous = recordFor(sec);
    const current = previous?.mark ?? readLegacy()[sec] ?? '';
    const effective = effectiveMark(sec,readMarks([sec])[sec]);
    if (effective !== seen) {
      state = readMarks(); render(); toast('此账号刚在其他页更改，请核对后再标记'); return false;
    }
    if (current === mark && seen===mark) return true;
    const rev = crypto.randomUUID();
    localStorage.setItem(decisionPrefix+sec,JSON.stringify({mark,rev,at:new Date().toISOString()}));
    state[sec] = mark;
    historyStack.push({sec,previous,rev,index:lbEl.open && lb.sec===sec ? lb.idx : 0});
    if (historyStack.length>50) historyStack.shift();
    persistHistory(); updateUndo();
    const row = $('content').querySelector('.card[data-sec="'+CSS.escape(sec)+'"]');
    if (row && current!=='conflict') updateMarkedRow(row,sec,markOf(sec));
    else render();
    return true;
  });
}
function updateMarkedRow(row,sec,mark) {
  if (!matches(byId.get(sec))) {
    const index = visible.findIndex(d => d.sec_uid === sec);
    if (index < cursor) setCursor(Math.max(0, cursor - 1));
    visible.splice(index, 1);
    const grid = row.parentElement;
    row.remove();
    if (!visible.length) {
      render();
      $('markFilter').focus({preventScroll:true});
      return;
    }
    const heading = grid.previousElementSibling;
    if (heading?.classList.contains('group')) {
      if (grid.childElementCount) heading.querySelector('span').textContent = grid.childElementCount + ' 人 · 粉丝升序';
      else { heading.remove(); grid.remove(); }
    }
    $('resultCount').textContent = '当前结果　' + visible.length + ' 人';
    rowPos();
    updateExport();
    counters();
    const nextSec = visible[Math.min(index,visible.length - 1)].sec_uid;
    $('content').querySelector('[data-sec="' + CSS.escape(nextSec) + '"] [data-mark="'  + (mark || 'keep') + '"]')?.focus({preventScroll:true});
  } else {
    row.classList.toggle('keep', mark === 'keep');
    row.classList.toggle('unf', mark === 'unf');
    row.querySelector('.b-reset').disabled=!mark;
    row.querySelectorAll('.b-keep,.b-unf').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mark === mark)));
    counters(); updateExport();
  }
}
async function undoDecision(showInViewer) {
  const last = latestUndo();
  if (!last) return;
  await withDecisionLock(last.sec,()=>{
    if (!historyStack.includes(last)) return;
    const same = recordFor(last.sec)?.rev === last.rev;
    if (same) {
      if (last.previous) localStorage.setItem(decisionPrefix+last.sec,JSON.stringify(last.previous));
      else localStorage.removeItem(decisionPrefix+last.sec);
    }
    historyStack.splice(historyStack.indexOf(last),1);
    persistHistory(); updateUndo();
    state = readMarks(); render();
    const author = byId.get(last.sec);
    if (showInViewer && same && visible.includes(author) && author.covers?.length) openLb(last.sec,last.index || 0);
    const message = same ? '已撤销：'+author.nickname : '此决定已有更新，已保留较新的标记';
    if (lbEl.open) $('lbReviewStatus').textContent=message; else toast(message);
  });
}
$('undo').addEventListener('click',e=>{ if(e.detail<=1) undoDecision(false); });
function refreshDecisions() {
  state = readMarks(); historyStack = readHistory(); updateUndo(); render();
  if (lbEl.open) {
    if (visible.includes(byId.get(lb.sec))) renderLb();
    else { closeLb(); toast('此账号的标记已在其他窗口更改'); }
  }
}
window.addEventListener('storage', e => {
  if (e.storageArea!==localStorage) return;
  if (e.key?.startsWith(decisionPrefix)) {
    const sec=e.key.slice(decisionPrefix.length);
    if (!byId.has(sec)) { state=readMarks(); updateExport(); return; }
    const row=$('content').querySelector('.card[data-sec="'+CSS.escape(sec)+'"]');
    if (row && $('markFilter').value==='all' && !fixedLabel(byId.get(sec))) {
      const old=markOf(sec); state=readMarks();
      const mark=markOf(sec);
      if (old!=='conflict' && mark!=='conflict') {
        updateMarkedRow(row,sec,mark);
        if (lbEl.open) renderLb();
        return;
      }
    }
  }
  if (e.key===null || e.key.startsWith(decisionPrefix) || legacyKeys.includes(e.key)) refreshDecisions();
});
window.addEventListener('pageshow',e=>{ if (e.persisted) refreshDecisions(); });
$('conflicts').addEventListener('click',()=>{
  filter='all'; $('search').value=''; $('multiOnly').checked=$('changedOnly').checked=false;
  $('markFilter').value='conflict'; changeView();
});
$('search').addEventListener('input', () => changeView({ keepSearch: true }));
$('sortOrder').addEventListener('change', changeView);
$('markFilter').addEventListener('change', changeView);
$('multiOnly').addEventListener('change', changeView);
$('changedOnly').addEventListener('change', changeView);
function followAccountLink() {
  const params = new URLSearchParams(location.hash.slice(1));
  const id = params.get('account');
  linkedAccount = Boolean(id);
  linkedAccountId = id || '';
  const notice=$('linkNotice');
  notice.hidden = !linkedAccount || !params.get('at') || params.get('at')===snapshotAt;
  if (!notice.hidden) notice.textContent='来源画廊和本页的快照时间不同，请以本页显示的数据日期为准。';
  $('returnToList').hidden = !linkedAccount;
  const trail=sourceTrail(params);
  const source=[...document.querySelectorAll('nav a')].find(a=>a.getAttribute('href')===trail.at(-1) && !a.hasAttribute('aria-current'));
  const back=$('backToSource');
  back.hidden=!(source && linkedAccount);
  if (!back.hidden) {
    const file=source.getAttribute('href'), root=params.get('focused')==='1';
    back.href=(trail.length>1 || root) ? authorLink(file,id,trail.slice(0,-1),root) : file;
    back.textContent='返回'+source.textContent;
  }
  if (!linkedAccount) { restoreView(); render(); restorePosition(); return; }
  filter = 'all'; $('markFilter').value = 'all'; $('multiOnly').checked = false; $('changedOnly').checked = false;
  $('search').value = id; setCursor(0); render();
}
window.addEventListener('hashchange',followAccountLink);
$('returnToList').addEventListener('click',()=>{
  clearAccountLink();
  restoreView();
  render(); restorePosition();
});
$('clearFilters').addEventListener('click',()=>{
  filter = 'all';
  $('search').value = '';
  $('markFilter').value = 'all';
  $('sortOrder').value = 'default';
  $('changedOnly').checked = $('multiOnly').checked = false;
  changeView();
  $('search').focus();
});
$('seg').addEventListener('click', e => {
  const button = e.target.closest('[data-f]');
  if (button) { filter = button.dataset.f; changeView(); }
});
function exportRows(scope) {
  if (scope==='combined') return union.filter(d=>!completed(d.sec_uid) && decided(markOf(d.sec_uid)));
  return scope==='all' ? DATA.filter(d=>!fixedLabel(d)) : visible.filter(d=>!fixedLabel(d));
}
function updateExport() {
  updateQueueButton();
  const scope = $('exportScope');
  const visibleRows = visible.filter(d=>!fixedLabel(d));
  const allRows = exportRows('all');
  const combinedRows = exportRows('combined');
  scope.options[0].textContent = '当前结果（'+visibleRows.length+' 位）';
  scope.options[1].textContent = '整个画廊（'+allRows.length+' 位）';
  scope.options[2].textContent = '三个画廊已标记（'+combinedRows.length+' 位）';
  const rows = scope.value==='combined' ? combinedRows : scope.value==='all' ? allRows : visibleRows;
  const totals={keep:0,unf:0,conflict:0,none:0};
  for (const d of rows) {
    const mark = markOf(d.sec_uid);
    totals[mark || 'none']++;
  }
  $('exportSummary').textContent='待导出：取关 '+totals.unf+' · 保留 '+totals.keep+
    (totals.none?' · 未审 '+totals.none:'')+(totals.conflict?' · 待复核 '+totals.conflict:'');
  $('btnCopy').disabled = $('btnDown').disabled = !rows.length;
}
$('exportScope').addEventListener('change',updateExport);
function decisionList() {
  const field = value => String(value ?? '').replace(/[\t\r\n]+/g, ' ');
  // Refresh the filter as well as the values if another tab just wrote a mark.
  const fresh = readMarks();
  if (Object.keys(fresh).length!==Object.keys(state).length || Object.keys(fresh).some(sec=>fresh[sec]!==state[sec])) {
    state=fresh; render();
  }
  const scope = $('exportScope').value;
  const rows = exportRows(scope);
  return rows.map(d => {
    const mark = markOf(d.sec_uid);
    return [d.sec_uid, d.nickname, d.douyin_id,
      mark === 'keep' ? '保留' : mark === 'unf' ? '取关' : mark === 'conflict' ? '待复核' : '未审'].map(field).join('\t');
  }).join('\n');
}
$('btnCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(decisionList()); toast('决定名单已复制'); }
  catch { toast('复制失败，可使用下载按钮保存名单'); }
});
$('btnDown').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([decisionList()], {type:'text/plain;charset=utf-8'}));
  const link = document.createElement('a');
  const scope=$('exportScope').value, gallery=document.querySelector('nav [aria-current]').textContent;
  const label=scope==='combined' ? '三个画廊已标记' : gallery+'-'+(scope==='all'?'整个画廊':'当前结果');
  const now=new Date(), pad=n=>String(n).padStart(2,'0');
  const stamp=now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate())+'_'+
    pad(now.getHours())+pad(now.getMinutes())+pad(now.getSeconds());
  link.href=url; link.download='decisions-'+label+'-快照'+document.querySelector('.dateline time').textContent+'-导出'+stamp+'.txt';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
