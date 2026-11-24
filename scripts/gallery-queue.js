let queueJob={running:false,rows:[],message:''}, queueMode='preview', previewRows=[], requesting=false, polling=false;
const onlineQueue=typeof window.guanxuUnfollow==='function';
function candidates() { return union.filter(d=>!completed(d.sec_uid) && markOf(d.sec_uid)==='unf'); }
function updateQueueButton() {
  const size=candidates().length;
  $('openQueue').textContent=queueJob.running ? '查看取关进度' : size ? '处理待取关（'+size+'）' : queueJob.rows.length ? '查看取关结果' : '待取关（0）';
}
function selectedRows() {
  return previewRows.filter((_,i)=>$('queueRows').querySelector('[data-index="'+i+'"]')?.checked);
}
function countSelected() {
  const n=selectedRows().length;
  $('queueConfirm').disabled=requesting || !onlineQueue || !n;
  $('queueConfirm').textContent=n?'确认取关这 '+n+' 位':'请选择要取关的博主';
}
function previewQueue() {
  queueMode='preview';
  $('queuePrevious').hidden=!queueJob.rows.length;
  state=readMarks();
  previewRows=candidates().map(d=>({...d,rev:recordFor(d.sec_uid)?.rev || 'legacy'}));
  $('queueTitle').textContent='核对待取关名单';
  $('queueHint').textContent=previewRows.length?'来自三个画廊，同一位博主只列一次。取消勾选可留到下次处理。确认后将从大号取关。':'在博主卡片或作品预览中标为「待取关」，就会出现在这里。';
  $('queueRows').innerHTML=previewRows.map((d,i)=>'<li><label><input type="checkbox" checked data-index="'+i+'"><span><strong>'+esc(d.nickname)+'</strong><small>抖音号 '+esc(d.douyin_id)+'</small></span></label></li>').join('');
  $('queueConfirm').hidden=!previewRows.length;
  $('queueMessage').textContent=onlineQueue?'':'要在这里执行取关，请从关序工作台打开此画廊。';
  countSelected();
}
function showQueueResult() {
  queueMode='result';
  $('queuePrevious').hidden=true;
  const rows=queueJob.rows;
  const done=rows.filter(d=>d.code==='done' || d.code==='absent').length;
  const failed=rows.filter(d=>d.code==='failed').length;
  $('queueTitle').textContent=queueJob.running?'正在处理取关':'本批取关结果';
  $('queueHint').textContent='共 '+rows.length+' 位 · 已确认未关注 '+done+' 位'+(failed?' · 需复核 '+failed+' 位':'');
  $('queueRows').innerHTML=rows.map(d=>'<li><span><strong>'+esc(d.name)+'</strong><small>抖音号 '+esc(d.id)+'</small></span><em>'+esc(d.detail || (d.code==='working'?'正在核对':'等待处理'))+'</em></li>').join('');
  $('queueMessage').textContent=queueJob.message || (queueJob.running?'可以继续审阅或切换画廊。请保持审阅浏览器打开。':'每位已核实的账号都已写入本机取关登记表。');
  $('queueConfirm').hidden=queueJob.running || !candidates().length;
  $('queueConfirm').disabled=requesting;
  $('queueConfirm').textContent='核对剩余待取关';
}
async function pollQueue() {
  if (!onlineQueue || polling) return;
  polling=true;
  try {
    const data=await window.guanxuUnfollow('status');
    const changed=JSON.stringify(receipts)!==JSON.stringify(data.receipts);
    const progress=JSON.stringify(queueJob.rows)!==JSON.stringify(data.rows) || queueJob.running!==data.running || queueJob.message!==data.message;
    receipts=data.receipts; queueJob=data;
    if (changed) refreshDecisions(); else updateQueueButton();
    if ($('queue').open && (queueMode==='result' || queueJob.running) && progress) showQueueResult();
  } catch { if ($('queue').open) $('queueMessage').textContent='无法读取处理进度，请检查工作台连接。'; }
  finally { polling=false; }
}
$('openQueue').onclick=async()=>{
  if (requesting) return;
  await pollQueue();
  if (queueJob.running || (queueJob.rows.length && !candidates().length)) showQueueResult(); else previewQueue();
  if (!$('queue').open) $('queue').showModal();
};
$('queueRows').addEventListener('change',countSelected);
$('queueConfirm').onclick=async()=>{
  if (requesting) return;
  if (queueMode==='result') { previewQueue(); return; }
  const selected=selectedRows();
  if (!selected.length || !onlineQueue) return;
  requesting=true;
  $('queueConfirm').disabled=true;
  try {
    await window.guanxuUnfollow('start',{stamp:snapshotAt,rows:selected.map(d=>({sec:d.sec_uid,rev:d.rev}))});
    queueMode='result';
    await pollQueue(); showQueueResult();
  } catch (err) {
    previewQueue();
    $('queueMessage').textContent=String(err.message).split('\n')[0].replace(/^.*?Error: /,'');
  } finally { requesting=false; if (queueMode==='preview') countSelected(); else showQueueResult(); }
};
$('queuePrevious').onclick=showQueueResult;
$('queueClose').onclick=$('queueReturn').onclick=()=>$('queue').close();
if (onlineQueue) {
  void pollQueue();
  setInterval(()=>{ if (!document.hidden) void pollQueue(); },1800);
  document.addEventListener('visibilitychange',()=>{ if (!document.hidden) void pollQueue(); });
}
