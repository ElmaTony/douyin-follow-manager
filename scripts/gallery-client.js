const { data: DATA, key: KEY, rowKey: ROWKEY, groups: GROUPS, presetKeep, protectedIds, filters: FILTERS } =
  JSON.parse(document.getElementById('gallery-data').textContent);
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
  for (const sec of presetKeep) if (!Object.hasOwn(marks, sec)) marks[sec] = 'keep';
  for (const d of DATA) if (fixedLabel(d)) marks[d.sec_uid] = 'keep';
  return marks;
}
let state = readMarks();
let cursor = 0;
try { cursor = Math.max(0, parseInt(localStorage.getItem(ROWKEY), 10) || 0); } catch {}
let filter = 'all', kw = '', visible = [];
let toastTimer;
function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('on'), 2800);
}
function setCursor(value) {
  cursor = value;
  try { localStorage.setItem(ROWKEY, String(cursor)); } catch {}
}
function matches(d) {
  switch (filter) {
    case 'all': return true;
    case 'cand': return !fixedLabel(d);
    case 'zero': return !fixedLabel(d) && d.works === 0;
    case 'keep': return !d.badgeFix && state[d.sec_uid] === 'keep';
    case 'none': return !fixedLabel(d) && !state[d.sec_uid];
    case 'banned': return Boolean(d.badgeFix);
    case 'high': case 'mid': return d.tier === filter;
    default: return d.group === filter;
  }
}
function counters() {
  let none = 0, keep = 0, unf = 0;
  for (const d of DATA) {
    if (fixedLabel(d)) continue;
    if (state[d.sec_uid] === 'keep') keep++;
    else if (state[d.sec_uid] === 'unf') unf++;
    else none++;
  }
  $('cNone').textContent = none;
  $('cKeep').textContent = keep;
  $('cUnf').textContent = unf;
}
function covers(d) {
  const srcs = (d.covers || []).slice(0, 3);
  if (!srcs.length) return `<div class="no-cover"><i class="frame-icon"></i>${esc(d.noneText || '暂无封面')}</div>`;
  return `<div class="covers">${srcs.map((src, i) => `<button class="cover" data-i="${i}" aria-label="查看第 ${i + 1} 张封面">
    <span class="fallback" hidden><i class="frame-icon"></i>封面暂不可用</span>
    <img loading="lazy" src="${esc(src)}" alt=""><span class="idx">${i + 1} / ${d.covers.length}</span></button>`).join('')}</div>`;
}
function card(d) {
  const locked = fixedLabel(d), mark = state[d.sec_uid], url = profile(d.sec_uid);
  const badges = [...(d.tags || []).filter(t => !(locked && t === '已标保留'))];
  if (d.secret) badges.push('私密');
  if (locked) badges.push(locked);
  const extras = (d.extraLines || []).filter(x => x?.text).map(x =>
    `<p class="extra ${x.cls === 'warn' ? 'warn' : x.cls === 'bad' ? 'bad' : ''}" title="${esc(x.text)}">${esc(x.text)}</p>`).join('');
  const details = [d.works != null ? '作品 ' + esc(d.works) : '', d.followers != null ? '粉丝 ' + esc(fmt(d.followers)) : ''].filter(Boolean);
  if (d.dateStr) details.push('最近更新 ' + esc(d.dateStr) + '（距快照 ' + esc(d.gap) + ' 天）');
  return `<article class="card ${locked ? 'fixed' : mark === 'keep' ? 'keep' : mark === 'unf' ? 'unf' : ''}" data-sec="${esc(d.sec_uid)}">
    <div class="info"><div class="row1"><a class="nick" href="${url}" target="_blank" rel="noopener">${esc(d.nickname)}</a><a class="plink" href="${url}" target="_blank" rel="noopener">主页 ↗</a></div>
    <div class="account-id">抖音号 ${esc(d.douyin_id || '—')}</div></div>
    ${covers(d)}
    <div class="body"><div class="meta">${details.join('　·　')}</div>
    ${badges.length ? '<div class="badges">' + badges.map(t => '<span>' + esc(t) + '</span>').join('') + '</div>' : ''}
    ${extras}</div>
    <div class="ops">${locked ? `<button class="b-lock" disabled>${esc(locked)} · 不可标记</button>` :
      `<button class="b-unf" data-mark="unf" aria-pressed="${mark === 'unf'}">取关</button>
       <button class="b-keep" data-mark="keep" aria-pressed="${mark === 'keep'}">保留</button>`}</div></article>`;
}
function rowPos() {
  const total = visible.length, end = cursor >= total;
  $('btnRow').disabled = end;
  $('btnRowReset').disabled = cursor === 0;
  $('rowPos').textContent = !total ? '' : end ? '已浏览至末尾' : `下一批　${cursor + 1}–${Math.min(cursor + 5, total)} / ${total}`;
}
function render() {
  visible = DATA.filter(d => matches(d) && (!kw || (d.nickname + ' ' + (d.douyin_id || '')).toLowerCase().includes(kw)));
  const grid = rows => '<div class="grid">' + rows.map(card).join('') + '</div>';
  let html = '';
  if (!visible.length) html = '<div class="empty"><strong>没有匹配的账号</strong><p>可更换筛选条件或搜索词。</p></div>';
  else if (filter === 'all' && GROUPS.length) {
    for (const group of GROUPS) {
      const rows = visible.filter(d => d.group === group.id);
      if (rows.length) html += `<div class="group"><h2>${esc(group.name)}</h2><span>${rows.length} 人 · 粉丝升序</span></div>${grid(rows)}`;
    }
  } else html = grid(visible);
  $('content').innerHTML = html;
  $('resultCount').textContent = `当前结果　${visible.length} 人`;
  document.querySelectorAll('[data-f]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f === filter)));
  counters();
  rowPos();
}
document.addEventListener('error', event => {
  const img = event.target;
  if (img.tagName !== 'IMG') return;
  const fallback = img.parentElement?.querySelector('.fallback,.missing');
  if (fallback) { img.hidden = true; fallback.hidden = false; }
}, true);
$('content').addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  const row = button.closest('.card');
  const sec = row.dataset.sec;
  if (button.classList.contains('cover')) { openLb(sec, Number(button.dataset.i)); return; }
  const mark = button.dataset.mark;
  if (!mark || fixedLabel(byId.get(sec))) return;
  const next = readMarks();
  next[sec] = mark;
  try { localStorage.setItem(KEY, JSON.stringify(next)); }
  catch { toast('标记未能保存，请检查浏览器存储权限'); return; }
  state = next;
  if (!matches(byId.get(sec))) {
    if (visible.findIndex(d => d.sec_uid === sec) < cursor) setCursor(Math.max(0, cursor - 1));
    render();
    $('seg').querySelector('[aria-pressed="true"]')?.focus({preventScroll:true});
  } else {
    row.classList.toggle('keep', mark === 'keep');
    row.classList.toggle('unf', mark === 'unf');
    row.querySelectorAll('[data-mark]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mark === mark)));
    counters();
  }
});
window.addEventListener('storage', e => {
  if (e.key === KEY || e.key === null) { state = readMarks(); render(); }
});
$('search').addEventListener('input', e => { kw = e.target.value.trim().toLowerCase(); setCursor(0); render(); });
$('seg').addEventListener('click', e => {
  const button = e.target.closest('[data-f]');
  if (button) { filter = button.dataset.f; setCursor(0); render(); }
});
function decisionList() {
  const field = value => String(value ?? '').replace(/[\t\r\n]+/g, ' ');
  return DATA.filter(d => !fixedLabel(d)).map(d => [d.sec_uid, d.nickname, d.douyin_id,
    state[d.sec_uid] === 'keep' ? '保留' : state[d.sec_uid] === 'unf' ? '取关' : '未审'].map(field).join('\t')).join('\n');
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
$('btnRow').addEventListener('click', async () => {
  const batch = visible.slice(cursor, cursor + 5);
  let opened = 0;
  for (const d of batch) {
    const tab = window.open('about:blank', '_blank');
    if (!tab) break;
    tab.opener = null;
    tab.location.replace(profile(d.sec_uid));
    opened++;
  }
  setCursor(cursor + opened);
  rowPos();
  const rest = batch.slice(opened);
  if (!rest.length) { toast(`已打开 ${opened} 个主页`); return; }
  try {
    await navigator.clipboard.writeText(rest.map(d => profile(d.sec_uid)).join('\n'));
    toast(`已打开 ${opened} 个，另 ${rest.length} 个链接已复制`);
  } catch { toast('部分主页未打开，可允许弹窗后重试'); }
});
$('btnRowReset').addEventListener('click', () => { setCursor(0); rowPos(); toast('浏览位置已重置'); });
