const { data: DATA, key: KEY, rowKey: ROWKEY, groups: GROUPS, presetKeep, protectedIds, filters: FILTERS, snapshotAt, timeZone } =
  JSON.parse(document.getElementById('gallery-data').textContent);
const currentGallery = document.querySelector('nav [aria-current="page"]').getAttribute('href');
const byId = new Map(DATA.map(d => [d.sec_uid, d]));
const protectedSet = new Set(protectedIds);
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const profile = sec => 'https://www.douyin.com/user/' + encodeURIComponent(sec);
const fixedLabel = d => d.badgeFix || (protectedSet.has(d.sec_uid) ? '名单保留' : '');
const fmt = n => n >= 10000 ? (n / 10000).toFixed(1) + '万' : String(n ?? '—');

function readMarks() {
  let marks = {};
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) marks = saved;
  } catch {}
  return marks;
}
let state = readMarks();
const preset = new Set(presetKeep);
const markOf = sec => state[sec] || (preset.has(sec) ? 'keep' : '');
let linkedAccount = false;
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
const exportable = DATA.filter(d=>!fixedLabel(d));
const sessionKey = KEY+':review-session:'+new URL('.',location.href).href;
let savedSession;
try { savedSession = JSON.parse(sessionStorage.getItem(sessionKey)); } catch {}
if (!savedSession || savedSession.snapshot !== snapshotAt) savedSession = {snapshot:snapshotAt};
const historyStack = Array.isArray(savedSession.undo) ? savedSession.undo.filter(x=>byId.has(x?.sec)) : [];
function saveSession() {
  savedSession.undo = historyStack.slice(-50);
  try { sessionStorage.setItem(sessionKey,JSON.stringify(savedSession)); } catch {}
}
function updateUndo() {
  const last = historyStack.at(-1);
  for (const id of ['undo','lbUndo']) {
    $(id).disabled = !last;
    $(id).title = last ? '撤销对 '+byId.get(last.sec).nickname+' 的标记' : '这次浏览还没有可撤销的标记';
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
function clearAccountLink() {
  if (!linkedAccount) return;
  linkedAccount = false;
  $('returnToList').hidden = true;
  $('backToSource').hidden = true;
  const url = new URL(location.href);
  url.hash = '';
  history.replaceState(history.state,'',url);
}
function changeView() {
  replayBatch = false;
  clearAccountLink();
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
  let none = 0, keep = 0, unf = 0;
  for (const d of DATA) {
    if (fixedLabel(d)) continue;
    if (markOf(d.sec_uid) === 'keep') keep++;
    else if (markOf(d.sec_uid) === 'unf') unf++;
    else none++;
  }
  $('cNone').textContent = none;
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
function card(d) {
  const locked = fixedLabel(d), mark = markOf(d.sec_uid), url = profile(d.sec_uid);
  const badges = [...(d.tags || []).filter(t => !(locked && t === '已标保留'))];
  for (const label of d.changes || []) if (!badges.includes(label)) badges.push(label);
  if (d.secret) badges.push('私密');
  if (locked) badges.push(locked);
  const extras = (d.extraLines || []).filter(x => x?.text).map(x =>
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
    ${(d.alsoIn || []).map(g=>'<a class="other-gallery" href="'+esc(g.href)+'#account='+encodeURIComponent(d.sec_uid)+'&amp;from='+encodeURIComponent(currentGallery)+(linkedAccount?'&amp;focused=1':'')+'">'+esc(g.name)+(g.note ? ' · '+esc(g.note) : '')+' ↗</a>').join('')}</div>
    <div class="ops">${locked ? `<button class="b-lock" disabled>${esc(locked)} · 不可标记</button>` :
      `<button class="b-unf" data-mark="unf" aria-pressed="${mark === 'unf'}">取关</button>
       <button class="b-keep" data-mark="keep" aria-pressed="${mark === 'keep'}">保留</button>`}</div></article>`;
}
function render() {
  const query = $('search').value.trim().normalize('NFKC').toLowerCase();
  visible = DATA.filter(d => matches(d) && (linkedAccount ? d.sec_uid === $('search').value : !query || searchText.get(d.sec_uid).includes(query)));
  const order = $('sortOrder').value;
  if (order === 'oldest') visible.sort((a,b) => b.gap - a.gap);
  if (order === 'followers') visible.sort((a,b) => (b.followers ?? -1) - (a.followers ?? -1));
  if (cursor > visible.length) setCursor(visible.length);
  const grid = rows => '<div class="grid">' + rows.map(card).join('') + '</div>';
  let html = '';
  if (!DATA.length) html = '<div class="empty"><strong>这次快照没有需要在此审阅的账号</strong></div>';
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
  const next = readMarks();
  if (next[sec] === mark) return;
  if (event.detail>0) {
    const last=lastPointerDecision;
    if (last && last.sec!==sec && event.timeStamp-last.time<400 &&
        Math.hypot(event.clientX-last.x,event.clientY-last.y)<5) return;
    lastPointerDecision={sec,time:event.timeStamp,x:event.clientX,y:event.clientY};
  }
  const before = next[sec];
  next[sec] = mark;
  if (!saveMarks(next)) return;
  historyStack.push({sec,before,mark,index:lbEl.open && lb.sec===sec ? lb.idx : 0});
  if (historyStack.length>50) historyStack.shift();
  saveSession(); updateUndo();
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
    $('content').querySelector('[data-sec="' + CSS.escape(nextSec) + '"] [data-mark="' + mark + '"]')?.focus({preventScroll:true});
  } else {
    row.classList.toggle('keep', mark === 'keep');
    row.classList.toggle('unf', mark === 'unf');
    row.querySelectorAll('[data-mark]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mark === mark)));
    counters();
  }
});
function saveMarks(next) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); }
  catch { toast('标记未能保存，请检查浏览器存储权限'); return false; }
  state = next;
  return true;
}
function undoDecision(showInViewer) {
  const last = historyStack.at(-1);
  if (!last) return;
  const next = readMarks();
  const canUndo = next[last.sec] === last.mark && !fixedLabel(byId.get(last.sec));
  if (!canUndo) {
    toast('此标记已在其他窗口更改');
  } else {
    if (last.before) next[last.sec] = last.before;
    else delete next[last.sec];
    if (!saveMarks(next)) return;
    toast('已撤销：' + byId.get(last.sec).nickname);
  }
  historyStack.pop();
  saveSession(); updateUndo();
  state = next;
  render();
  if (showInViewer && canUndo && visible.includes(byId.get(last.sec)) && byId.get(last.sec).covers?.length) openLb(last.sec,last.index || 0);
}
$('undo').addEventListener('click',e=>{ if(e.detail<=1) undoDecision(false); });
window.addEventListener('storage', e => {
  if (e.key === KEY || e.key === null) {
    state = readMarks(); render();
    if (lbEl.open) {
      if (visible.includes(byId.get(lb.sec))) renderLb();
      else { closeLb(); toast('此账号的标记已在其他窗口更改'); }
    }
  }
});
$('search').addEventListener('input', changeView);
$('sortOrder').addEventListener('change', changeView);
$('markFilter').addEventListener('change', changeView);
$('multiOnly').addEventListener('change', changeView);
$('changedOnly').addEventListener('change', changeView);
function followAccountLink() {
  const params = new URLSearchParams(location.hash.slice(1));
  const id = params.get('account');
  linkedAccount = Boolean(id && byId.has(id));
  $('returnToList').hidden = !linkedAccount;
  const source=[...document.querySelectorAll('nav a')].find(a=>a.getAttribute('href')===params.get('from') && !a.hasAttribute('aria-current'));
  const back=$('backToSource');
  back.hidden=!(source && linkedAccount);
  if (!back.hidden) {
    back.href=source.getAttribute('href')+(params.get('focused')==='1' ? '#account='+encodeURIComponent(id) : '');
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
function updateExport() {
  const scope = $('exportScope');
  const count = visible.filter(d=>!fixedLabel(d)).length;
  scope.options[0].textContent = '当前结果（'+count+' 位）';
  scope.options[1].textContent = '整个画廊（'+exportable.length+' 位）';
  $('btnCopy').disabled = $('btnDown').disabled = !(scope.value === 'all' ? exportable.length : count);
}
$('exportScope').addEventListener('change',updateExport);
function decisionList() {
  const field = value => String(value ?? '').replace(/[\t\r\n]+/g, ' ');
  const rows = $('exportScope').value === 'all' ? exportable : visible.filter(d=>!fixedLabel(d));
  return rows.map(d => [d.sec_uid, d.nickname, d.douyin_id,
    markOf(d.sec_uid) === 'keep' ? '保留' : markOf(d.sec_uid) === 'unf' ? '取关' : '未审'].map(field).join('\t')).join('\n');
}
$('btnCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(decisionList()); toast('决定名单已复制'); }
  catch { toast('复制失败，可使用下载按钮保存名单'); }
});
$('btnDown').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([decisionList()], {type:'text/plain;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url; link.download = 'decisions.txt'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
