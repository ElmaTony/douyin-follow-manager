const MIN_MAX_SCALE=2.0,DRAG_DEADZONE=4.0,WHEEL_SENSITIVITY=0.01,SNAP_MIN_SCALE=1.05;
let lb={sec:null,idx:0,scale:1,tx:0,ty:0,idealTx:0,idealTy:0,maxTx:0,maxTy:0,drag:null,moved:false};
const lbEl=document.getElementById('lb'),lbView=document.getElementById('lbView'),lbRunway=document.getElementById('lbRunway');
const clamp=(v,m)=>Math.min(m,Math.max(-m,v));
const overflow=(size,vp)=>Math.max(0,(size-vp)/2);
const maxTranslate=(fit,vp,scale)=>overflow(fit*scale,vp)*Math.min(1,Math.max(0,(scale-SNAP_MIN_SCALE)/0.95));
function activeImg(){return lbRunway.querySelector('.slide[data-i="'+lb.idx+'"] img')}
function fitRects(){const img=activeImg();const vr=lbView.getBoundingClientRect();
  const w=img.offsetWidth||1,h=img.offsetHeight||1;
  return {w,h,cx:vr.left+vr.width/2,cy:vr.top+vr.height/2,maxScale:Math.max((img.naturalWidth||w)/w,MIN_MAX_SCALE),vw:vr.width,vh:vr.height};}
function applyT(animate){
  const img=activeImg();if(!img)return;
  img.style.transition=animate?'transform 220ms ease-out':'none';
  img.style.transform='translate('+lb.tx+'px,'+lb.ty+'px) scale('+lb.scale+')';
  img.classList.toggle('zoomed',lb.scale>1);
  const z=document.getElementById('lbZoom');z.classList.toggle('on',lb.scale>1);z.textContent=Math.round(lb.scale*100)+'%';
}
function setScale(target,pointer,animate){
  const f=fitRects();target=Math.min(Math.max(target,1),f.maxScale);
  if(target<=SNAP_MIN_SCALE){lb.scale=1;lb.tx=0;lb.ty=0;lb.idealTx=0;lb.idealTy=0;lb.maxTx=0;lb.maxTy=0;applyT(true);return}
  const ox=pointer?pointer.clientX-f.cx:0,oy=pointer?pointer.clientY-f.cy:0;
  const c=target/lb.scale;
  const itx=ox-(ox-lb.idealTx)*c,ity=oy-(oy-lb.idealTy)*c;
  lb.maxTx=maxTranslate(f.w,f.vw,target);lb.maxTy=maxTranslate(f.h,f.vh,target);
  lb.idealTx=itx;lb.idealTy=ity;
  lb.tx=clamp(itx,lb.maxTx);lb.ty=clamp(ity,lb.maxTy);
  lb.scale=target;applyT(animate!==false);
}
const skippedInPreview = new Set();
function openLb(sec,idx){
  const d=byId.get(sec);if(!d||!(d.covers||[]).length)return;
  if(lb.sec!==sec) lbRunway.replaceChildren();
  document.getElementById('lbZoom').classList.remove('on');
  lb.sec=sec;lb.idx=Math.min(idx,d.covers.length-1);lb.scale=1;lb.tx=0;lb.ty=0;lb.idealTx=0;lb.idealTy=0;lb.drag=null;lb.moved=false;
  if(!lbEl.open) lbEl.showModal();
  renderLb();document.body.style.overflow='hidden';
}
function renderLb(){
  const d=byId.get(lb.sec);if(!d)return;
  const covers=d.covers||[];
  const works = d.posts?.filter(p=>p.cover);
  if (!lbRunway.childElementCount) lbRunway.innerHTML=covers.map((u,i)=>'<div class="slide" data-i="'+i+'"><span class="missing" hidden>封面暂不可用</span><img loading="lazy" src="'+esc(u)+'" data-alternate="'+esc(works?.[i]?.alternateCover || '')+'" alt="作品封面"></div>').join('');
  lbRunway.style.transform='translateX(calc(12.5vw - '+(lb.idx*75)+'vw - '+(lb.idx*32)+'px))';
  const imgs=[...lbRunway.querySelectorAll('img')];
  imgs.forEach((img,i)=>img.classList.toggle('active',i===lb.idx));
  const act=imgs[lb.idx];
  if(act){if(!act.complete)act.addEventListener('load',()=>applyT(false),{once:true});else setTimeout(()=>applyT(false),30);}
  document.getElementById('lbWho').textContent=d.nickname;
  $('lbProfile').href=profile(d.sec_uid);
  $('lbProfile').dataset.profile=d.sec_uid;
  $('lbProfile').textContent=profileLabel(d.sec_uid,true);
  const locked=fixedLabel(d);
  $('lbKeep').disabled=$('lbUnf').disabled=Boolean(locked);
  $('lbSkip').disabled=!nextReviewer(d);
  $('lbReviewStatus').textContent=locked || ({keep:'已标保留',unf:'已标取关',conflict:'旧标记冲突 · 请重新选择'}[markOf(d.sec_uid)] || '未标记');
  const work = works?.[lb.idx];
  document.getElementById('lbAttr').textContent=work ? [workDate(work),work.caption].filter(Boolean).join(' · ') : '历史封面';
  const link = document.getElementById('lbWork'), url = workUrl(work);
  link.hidden = !url;
  if (url) link.href=url; else link.removeAttribute('href');
  document.getElementById('lbPos').textContent=(lb.idx+1)+' / '+covers.length;
  document.getElementById('lbPrev').disabled=lb.idx===0;
  document.getElementById('lbNext').disabled=lb.idx===covers.length-1;
}
function nextReviewer(current) {
  const at = visible.indexOf(current);
  for (let n=1;n<visible.length;n++) {
    const d=visible[(at+n)%visible.length];
    if (d.covers?.length && !fixedLabel(d) && !markOf(d.sec_uid) && !skippedInPreview.has(d.sec_uid)) return d;
  }
}
let markingInViewer = false;
async function markAndAdvance(mark) {
  const current=byId.get(lb.sec);
  if (markingInViewer || !current || fixedLabel(current)) return;
  const next=nextReviewer(current);
  const statusEl=$('lbReviewStatus');
  const baseStatus={keep:'已标保留',unf:'已标取关',conflict:'旧标记冲突 · 请重新选择'}[markOf(current.sec_uid)] || '未标记';
  statusEl.textContent=baseStatus;
  markingInViewer=true;
  let saved;
  try { saved=await applyDecision(current.sec_uid,mark); } finally { markingInViewer=false; }
  if (!lbEl.open || lb.sec!==current.sec_uid) return;
  if (!saved) {
    if (statusEl.textContent===baseStatus) statusEl.textContent='本次未保存，请核对后重试';
    return;
  }
  if (next) openLb(next.sec_uid,0);
  else {
    closeLb();
    const remaining = visible.filter(d=>!d.covers?.length && !fixedLabel(d) && !markOf(d.sec_uid)).length;
    const skipped=visible.filter(d=>skippedInPreview.has(d.sec_uid) && !markOf(d.sec_uid)).length;
    const left=[skipped ? '暂跳 '+skipped+' 位' : '',remaining ? '无封面未标 '+remaining+' 位' : ''].filter(Boolean);
    toast(left.length ? '本次连续预览结束，'+left.join('，') : '当前结果中的未标账号已审完');
  }
}
$('lbSkip').addEventListener('click',e=>{
  if (e.detail>1) return;
  const next=nextReviewer(byId.get(lb.sec));
  if (next) { skippedInPreview.add(lb.sec); openLb(next.sec_uid,0); }
});
$('lbKeep').addEventListener('click',e=>{ if(e.detail<=1) markAndAdvance('keep'); });
$('lbUnf').addEventListener('click',e=>{ if(e.detail<=1) markAndAdvance('unf'); });
$('lbUndo').addEventListener('click',e=>{ if(e.detail<=1) undoDecision(true); });
lbEl.addEventListener('keydown',e=>{
  if(e.repeat && ['Enter',' '].includes(e.key) && e.target.closest('.lb-review button')) e.preventDefault();
});
function closeLb(){lbEl.close()}
lbEl.addEventListener('close',()=>{
  if (lbEl.open) return;
  skippedInPreview.clear();
  document.body.style.overflow=''; lbRunway.replaceChildren(); lb.drag=null;
  const row=$('content').querySelector('[data-sec="'+CSS.escape(lb.sec)+'"]');
  const cover=row?.querySelectorAll('.cover')[Math.min(lb.idx,2)] || row?.querySelector('.cover');
  if (cover) { cover.focus({preventScroll:true}); cover.scrollIntoView({block:'nearest'}); }
  else {
    const fallback=$('content').querySelector('.card .cover, .card [data-mark]') || $('markFilter');
    fallback?.focus({preventScroll:true});
  }
});
function move(delta){
  const d=byId.get(lb.sec);if(!d)return;
  const n=(d.covers||[]).length;const ni=lb.idx+delta;if(ni<0||ni>=n)return;
  const prev=activeImg();
  if(prev){prev.style.transition='none';prev.style.transform='';prev.classList.remove('zoomed');}
  lb.idx=ni;lb.scale=1;lb.tx=0;lb.ty=0;lb.idealTx=0;lb.idealTy=0;
  document.getElementById('lbZoom').classList.remove('on');renderLb();
}
document.getElementById('lbClose').addEventListener('click',e=>{e.stopPropagation();closeLb()});
document.getElementById('lbPrev').addEventListener('click',e=>{e.stopPropagation();move(-1)});
document.getElementById('lbNext').addEventListener('click',e=>{e.stopPropagation();move(1)});
lbView.addEventListener('click',e=>{
  if(e.target.closest('.navpill'))return;
  if(lb.moved){lb.moved=false;return}
  if(e.target.tagName==='IMG')return;
  if(lb.scale>1){setScale(1,null,true);return}
  closeLb();
});
lbEl.addEventListener('wheel',e=>{
  if(!lbEl.open)return;
  e.preventDefault();if(activeImg()?.hidden)return;const f=fitRects();
  const z=Math.exp(-e.deltaY*WHEEL_SENSITIVITY);
  setScale(Math.min(Math.max(lb.scale*z,1),f.maxScale),{clientX:e.clientX,clientY:e.clientY},false);
},{passive:false});
lbEl.addEventListener('pointerdown',e=>{
  if(e.target!==activeImg()||lb.scale<=1)return;
  lb.drag={id:e.pointerId,sx:e.clientX,sy:e.clientY,tx:lb.tx,ty:lb.ty};lb.moved=false;
  e.target.setPointerCapture(e.pointerId);
});
lbEl.addEventListener('pointermove',e=>{
  if(!lb.drag||e.pointerId!==lb.drag.id)return;
  const dx=e.clientX-lb.drag.sx,dy=e.clientY-lb.drag.sy;
  if(!lb.moved&&Math.hypot(dx,dy)<DRAG_DEADZONE)return;
  lb.moved=true;
  lb.tx=clamp(lb.drag.tx+dx,lb.maxTx);lb.ty=clamp(lb.drag.ty+dy,lb.maxTy);
  applyT(false);
});
lbEl.addEventListener('pointerup',e=>{if(lb.drag&&e.pointerId===lb.drag.id){lb.drag=null;lb.idealTx=lb.tx;lb.idealTy=lb.ty}});
lbEl.addEventListener('pointercancel',()=>{lb.drag=null;lb.moved=false});
lbEl.addEventListener('dblclick',e=>{
  if(e.target!==activeImg())return;
  if(lb.scale>1){setScale(1,null,true)}else{const f=fitRects();setScale(f.maxScale,{clientX:e.clientX,clientY:e.clientY},true)}
});
document.addEventListener('keydown',e=>{
  if(!lbEl.open)return;
  if(e.key==='Escape'){e.preventDefault();closeLb();return}
  if(e.altKey||e.ctrlKey||e.metaKey)return;
  if(e.key==='ArrowLeft'){e.preventDefault();move(-1)}
  else if(e.key==='ArrowRight'){e.preventDefault();move(1)}
  else if(e.key==='Home'){e.preventDefault();move(-lb.idx)}
  else if(e.key==='End'){e.preventDefault();move(byId.get(lb.sec).covers.length-1-lb.idx)}
});