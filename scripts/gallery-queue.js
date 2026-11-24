let queueJob={running:false,rows:[],message:''}, queueMode='preview', previewRows=[], retryScope=false;
let requesting=false, statusRequest=null;
const onlineQueue=typeof window.guanxuUnfollow==='function';
const deferredKey='guanxu:queue-defer:'+new URL('.',location.href).href+':';
const unresolved=code=>['failed','unverified','unstarted'].includes(code);
function candidates() { return union.filter(d=>!completed(d.sec_uid) && markOf(d.sec_uid)==='unf'); }
function pendingRows() {
  const revisions=retryScope ? new Map(queueJob.rows.filter(d=>unresolved(d.code)).map(d=>[d.sec,d.rev])) : null;
  return candidates().map(d=>({...d,rev:recordFor(d.sec_uid)?.rev || 'legacy'}))
    .filter(d=>!revisions || (queueJob.stamp===snapshotAt && revisions.get(d.sec_uid)===d.rev));
}
function selectedRows() {
  return [...$('queueRows').querySelectorAll('input:checked')].map(box=>previewRows[Number(box.dataset.index)]);
}
function countSelected() {
  const n=$('queueRows').querySelectorAll('input:checked').length;
  $('queueSelect').hidden=!previewRows.length;
  $('queueSelect').disabled=requesting;
  $('queueSelect').textContent=n?'全不选':'全选';
  $('queueConfirm').disabled=requesting || !onlineQueue || !n;
  $('queueConfirm').textContent=n?'确认取关这 '+n+' 位':'请选择要取关的博主';
}
function drawPreview(rows,previous) {
  previewRows=rows;
  $('queueRows').innerHTML=rows.map((d,i)=>{
    const saved=localStorage.getItem(deferredKey+d.sec_uid);
    const checked=saved!==JSON.stringify([snapshotAt,d.rev]) && (!previous || previous.get(d.sec_uid)===d.rev);
    return '<li><label><input type="checkbox" '+(checked?'checked ':'')+'data-index="'+i+'"><span><strong>'+esc(d.nickname)+'</strong><small>抖音号 '+esc(d.douyin_id)+'</small></span></label></li>';
  }).join('');
  $('queueConfirm').hidden=!rows.length;
  countSelected();
}
function updateQueueButton() {
  const size=candidates().length;
  $('openQueue').textContent=queueJob.running?'查看取关进度':size?'处理待取关（'+size+'）':queueJob.rows.length?'查看取关结果':'待取关（0）';
  if (!$('queue').open || queueMode!=='preview') return;
  const current=pendingRows();
  if (current.length===previewRows.length && current.every((d,i)=>d.sec_uid===previewRows[i].sec_uid && d.rev===previewRows[i].rev)) return;
  drawPreview(current,new Map(selectedRows().map(d=>[d.sec_uid,d.rev])));
  $('queueMessage').textContent='审阅标记已更新，请核对当前勾选。';
}
function previewQueue(onlyRetry=false,previous=null) {
  queueMode='preview'; retryScope=onlyRetry; state=readMarks();
  const rows=pendingRows();
  $('queuePrevious').hidden=!queueJob.rows.length;
  $('queuePrevious').textContent='上批结果';
  $('queueTitle').textContent=onlyRetry?'核对上批未完成项':'核对待取关名单';
  $('queueHint').textContent=onlyRetry?'仅列出上批未完成、仍标为待取关的同一笔决定。':
    rows.length?'三个画廊合并去重。取消勾选会在本次快照内保留。确认后将从大号取关。':'在博主卡片或作品预览中标为「待取关」，就会出现在这里。';
  $('queueMessage').textContent=onlineQueue?'':'要在这里执行取关，请从关序工作台打开此画廊。';
  drawPreview(rows,previous);
}
function showQueueResult() {
  queueMode='result';
  $('queueSelect').hidden=true;
  const rows=queueJob.rows;
  const done=rows.filter(d=>d.code==='done' || d.code==='absent').length;
  const failed=rows.filter(d=>unresolved(d.code)).length;
  const pending=new Set(candidates().map(d=>d.sec_uid));
  const retry=queueJob.stamp===snapshotAt && rows.some(d=>unresolved(d.code) && pending.has(d.sec) && (recordFor(d.sec)?.rev || 'legacy')===d.rev);
  $('queueTitle').textContent=queueJob.running?'正在处理取关':'上批取关结果';
  $('queueHint').textContent='共 '+rows.length+' 位 · 已确认未关注 '+done+' 位'+(failed?' · 未完成 '+failed+' 位':'');
  $('queueRows').innerHTML=rows.map(d=>'<li><span><strong>'+esc(d.name)+'</strong><small>抖音号 '+esc(d.id)+'</small></span><em>'+esc(d.detail || (d.code==='working'?'正在核对':'等待处理'))+'</em></li>').join('');
  $('queueMessage').textContent=queueJob.message || (queueJob.running?'可以继续审阅或切换画廊。请保持审阅浏览器打开。':'已核实的结果已写入本机取关登记表。');
  $('queuePrevious').hidden=queueJob.running || !retry;
  $('queuePrevious').textContent='全部待取关';
  $('queueConfirm').hidden=queueJob.running || !pending.size;
  $('queueConfirm').disabled=requesting;
  $('queueConfirm').dataset.scope=retry?'retry':'all';
  $('queueConfirm').textContent=retry?'只核对上批未完成项':'核对全部待取关';
}
function pollQueue() {
  if (!onlineQueue) return;
  if (statusRequest) return statusRequest;
  statusRequest=window.guanxuUnfollow('status').then(data=>{
    const {receipts:fresh,...job}=data;
    const changed=JSON.stringify(receipts)!==JSON.stringify(fresh);
    const progress=JSON.stringify(queueJob)!==JSON.stringify(job);
    receipts=fresh; queueJob=job;
    if (changed) refreshDecisions(); else if (progress) updateQueueButton();
    if ($('queue').open && (queueMode==='result' || job.running) && (progress || changed)) showQueueResult();
  }).catch(()=>{ if ($('queue').open) $('queueMessage').textContent='无法读取处理进度，请检查工作台连接。'; })
    .finally(()=>{ statusRequest=null; });
  return statusRequest;
}
$('openQueue').onclick=async()=>{
  if (requesting) return;
  await pollQueue();
  if (queueJob.running || (queueJob.rows.length && (!candidates().length || queueJob.message))) showQueueResult(); else previewQueue();
  if (!$('queue').open) $('queue').showModal();
};
function rememberChoice(box) {
  const d=previewRows[Number(box.dataset.index)];
  if (box.checked) localStorage.removeItem(deferredKey+d.sec_uid);
  else localStorage.setItem(deferredKey+d.sec_uid,JSON.stringify([snapshotAt,d.rev]));
}
$('queueRows').addEventListener('change',event=>{
  if (queueMode!=='preview') return;
  rememberChoice(event.target);
  countSelected();
});
$('queueSelect').onclick=()=>{
  if (queueMode!=='preview' || requesting) return;
  const check=!$('queueRows').querySelector('input:checked');
  for (const box of $('queueRows').querySelectorAll('input')) {
    if (box.checked===check) continue;
    box.checked=check;
    rememberChoice(box);
  }
  countSelected();
};
window.addEventListener('storage',event=>{
  if (!event.key?.startsWith(deferredKey) || !$('queue').open || queueMode!=='preview') return;
  const i=previewRows.findIndex(d=>deferredKey+d.sec_uid===event.key);
  if (i>=0) {
    $('queueRows').querySelector('[data-index="'+i+'"]').checked=event.newValue!==JSON.stringify([snapshotAt,previewRows[i].rev]);
    countSelected();
  }
});
$('queueConfirm').onclick=async()=>{
  if (requesting) return;
  if (queueMode==='result') { previewQueue($('queueConfirm').dataset.scope==='retry'); return; }
  const selected=selectedRows();
  if (!selected.length || !onlineQueue) return;
  requesting=true;
  $('queueConfirm').disabled=true;
  try {
    await window.guanxuUnfollow('start',{stamp:snapshotAt,rows:selected.map(d=>({sec:d.sec_uid,rev:d.rev}))});
    queueMode='result';
    if (statusRequest) await statusRequest;
    await pollQueue(); showQueueResult();
  } catch (err) {
    previewQueue(retryScope,new Map(selected.map(d=>[d.sec_uid,d.rev])));
    $('queueMessage').textContent=String(err.message).split('\n')[0].replace(/^.*?Error: /,'');
  } finally { requesting=false; if (queueMode==='preview') countSelected(); else showQueueResult(); }
};
$('queuePrevious').onclick=()=>{ if (queueMode==='result') previewQueue(); else showQueueResult(); };
$('queueClose').onclick=$('queueReturn').onclick=()=>$('queue').close();
if (onlineQueue) {
  void pollQueue();
  setInterval(()=>{ if (!document.hidden) void pollQueue(); },1800);
  document.addEventListener('visibilitychange',()=>{ if (!document.hidden) void pollQueue(); });
}
