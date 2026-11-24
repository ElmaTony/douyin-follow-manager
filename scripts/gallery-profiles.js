// Keep profile visits separate from review decisions. All three local galleries share one folder.
const profilePrefix = 'guanxu:profile:'+new URL('.',location.href).href+':';
const settingsPrefix = profilePrefix+'setting:';
const deliveries = new Map();
let replayBatch = false;
function loadDelivery(sec) {
  try {
    const entry = JSON.parse(localStorage.getItem(profilePrefix+sec));
    if (entry?.snapshot === snapshotAt && ['open','copied'].includes(entry.kind)) deliveries.set(sec,entry.kind);
    else deliveries.delete(sec);
  } catch {}
}
for (const sec of byId.keys()) loadDelivery(sec);
function profileLabel(sec,expanded=false) {
  const kind = deliveries.get(sec);
  if (kind === 'open') return '再看主页 ↗';
  if (kind === 'copied') return '链接已复制 · 打开主页 ↗';
  return expanded ? '打开主页 ↗' : '主页 ↗';
}
function refreshProfileLabel(sec) {
  for (const link of document.querySelectorAll('[data-profile="'+CSS.escape(sec)+'"]')) {
    if (link.classList.contains('nick')) continue;
    link.textContent = profileLabel(sec,link.id === 'lbProfile');
  }
}
function recordDelivery(sec,kind) {
  if (kind === 'copied' && deliveries.get(sec) === 'open') return;
  deliveries.set(sec,kind);
  try {
    const key = profilePrefix+sec;
    const stored = JSON.parse(localStorage.getItem(key));
    if (!(Date.parse(stored?.snapshot)>Date.parse(snapshotAt))) {
      localStorage.setItem(key,JSON.stringify({snapshot:snapshotAt,kind}));
    }
  } catch {}
  refreshProfileLabel(sec);
}
const reuseProfile=$('reuseProfile');
if (typeof window.guanxuOpenProfile === 'function') {
  $('reuseSetting').hidden=false;
  try { reuseProfile.checked=localStorage.getItem(settingsPrefix+'reuse')==='1'; } catch {}
}
reuseProfile.addEventListener('change',()=>{
  try { localStorage.setItem(settingsPrefix+'reuse',reuseProfile.checked?'1':'0'); } catch {}
});
async function openInProfileTab(sec) {
  let ok=false;
  try { ok=await window.guanxuOpenProfile(sec); } catch {}
  if (ok) recordDelivery(sec,'open');
  else {
    const message='主页未打开，可取消复用或用 Ctrl 单击另开';
    if (lbEl.open) $('lbReviewStatus').textContent=message;
    else toast(message);
  }
  rowPos();
  return ok;
}
function profileClick(e) {
  const link=e.target.closest('a[data-profile]');
  if (!link || e.defaultPrevented || (e.type==='auxclick' ? e.button!==1 : e.button!==0) || e.altKey) return;
  if (e.detail>1 && e.type==='click') { e.preventDefault(); return; }
  if (reuseProfile.checked && e.type==='click' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    e.preventDefault();
    void openInProfileTab(link.dataset.profile);
    return;
  }
  recordDelivery(link.dataset.profile,'open');
  rowPos();
}
document.addEventListener('click',profileClick);
document.addEventListener('auxclick',profileClick);
window.addEventListener('storage',e=>{
  if (e.key===settingsPrefix+'batchSize') {
    batchSize.value=e.newValue==='1'?'1':'5'; rowPos(); return;
  }
  if (e.key===settingsPrefix+'reuse') {
    reuseProfile.checked=!$('reuseSetting').hidden && e.newValue==='1'; return;
  }
  if (!e.key?.startsWith(profilePrefix)) return;
  const sec=e.key.slice(profilePrefix.length);
  if (byId.has(sec)) { loadDelivery(sec); refreshProfileLabel(sec); rowPos(); }
});
const batchSize = $('batchSize');
try { batchSize.value = localStorage.getItem(settingsPrefix+'batchSize') === '1' ? '1' : '5'; } catch {}
function pendingBatch() {
  const remaining = visible.slice(cursor);
  return replayBatch ? remaining : remaining.filter(d=>!deliveries.has(d.sec_uid));
}
function rowPos() {
  const remaining = pendingBatch(), size=Number(batchSize.value);
  $('btnRow').disabled = !remaining.length || copyingBatch;
  $('btnRowReset').disabled = copyingBatch || (!cursor && !visible.some(d=>deliveries.has(d.sec_uid)));
  $('btnRow').textContent = size===1 ? '打开下一位主页' : '打开下 5 位主页';
  if (!visible.length) { $('rowPos').textContent=''; return; }
  if (!remaining.length) { $('rowPos').textContent='当前结果的主页链接已处理完'; return; }
  const first=visible.indexOf(remaining[0])+1;
  const last=visible.indexOf(remaining[Math.min(size,remaining.length)-1])+1;
  $('rowPos').textContent=(replayBatch?'从头重看':'下一批')+'　'+first+'–'+last+' / '+visible.length+'　·　剩余 '+remaining.length+' 位';
}
batchSize.addEventListener('change',()=>{
  try { localStorage.setItem(settingsPrefix+'batchSize',batchSize.value); } catch {}
  rowPos();
});
$('btnRow').addEventListener('click', async e=>{
  if (copyingBatch || e.detail>1) return;
  const view=visible, batch=pendingBatch().slice(0,Number(batchSize.value));
  if (batchSize.value==='1' && reuseProfile.checked && batch.length) {
    copyingBatch=true; rowPos();
    const start=cursor;
    try {
      if (await openInProfileTab(batch[0].sec_uid) && visible===view && cursor===start && view.includes(batch[0])) {
        setCursor(view.indexOf(batch[0])+1);
      }
    } finally { copyingBatch=false; rowPos(); }
    return;
  }
  let opened=0;
  for (const d of batch) {
    const tab=window.open('about:blank','_blank');
    if (!tab) break;
    tab.opener=null;
    tab.location.replace(profile(d.sec_uid));
    recordDelivery(d.sec_uid,'open');
    opened++;
  }
  if (opened) setCursor(view.indexOf(batch[opened-1])+1);
  const rest=batch.slice(opened);
  if (!rest.length) { rowPos(); toast('已打开 '+opened+' 个主页'); return; }
  copyingBatch=true; rowPos();
  const pendingCursor=cursor;
  try {
    await navigator.clipboard.writeText(rest.map(d=>profile(d.sec_uid)).join('\n'));
    for (const d of rest) recordDelivery(d.sec_uid,'copied');
    const last=view.indexOf(rest.at(-1));
    if (view===visible && pendingCursor===cursor && last>=cursor) setCursor(last+1);
    toast('已打开 '+opened+' 个，另 '+rest.length+' 个链接已复制');
  } catch { toast('剩余主页链接未能复制，可允许弹窗后重试'); }
  finally { copyingBatch=false;rowPos(); }
});
$('btnRowReset').addEventListener('click',()=>{
  replayBatch=true; setCursor(0); rowPos(); toast('将从当前结果第一位重新打开主页');
});
const controls=document.querySelector('.controls'), mast=document.querySelector('.mast');
const resizeSticky = new ResizeObserver(()=>{
  document.documentElement.style.setProperty('--gallery-sticky-height',(mast.offsetHeight+controls.offsetHeight+8)+'px');
});
resizeSticky.observe(mast);resizeSticky.observe(controls);
