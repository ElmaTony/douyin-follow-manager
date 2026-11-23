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
function openLb(sec,idx){
  const d=byId.get(sec);if(!d||!(d.covers||[]).length)return;
  lb.sec=sec;lb.idx=Math.min(idx,d.covers.length-1);lb.scale=1;lb.tx=0;lb.ty=0;lb.idealTx=0;lb.idealTy=0;lb.drag=null;lb.moved=false;
  lbEl.showModal();renderLb();document.body.style.overflow='hidden';
}
function renderLb(){
  const d=byId.get(lb.sec);if(!d)return;
  const covers=d.covers||[];
  lbRunway.innerHTML=covers.map((u,i)=>'<div class="slide" data-i="'+i+'"><span class="missing" hidden>封面暂不可用</span><img src="'+esc(u)+'" alt="作品封面"></div>').join('');
  lbRunway.style.transform='translateX(calc(12.5vw - '+(lb.idx*75)+'vw - '+(lb.idx*32)+'px))';
  const imgs=[...lbRunway.querySelectorAll('img')];
  imgs.forEach((img,i)=>img.classList.toggle('active',i===lb.idx));
  const act=imgs[lb.idx];
  if(act){if(!act.complete)act.addEventListener('load',()=>applyT(false),{once:true});else setTimeout(()=>applyT(false),30);}
  document.getElementById('lbWho').textContent=d.nickname;
  document.getElementById('lbAttr').textContent=d.captions?.[lb.idx] || '';
  document.getElementById('lbPos').textContent=(lb.idx+1)+' / '+covers.length;
  document.getElementById('lbPrev').disabled=lb.idx===0;
  document.getElementById('lbNext').disabled=lb.idx===covers.length-1;
}
function closeLb(){lbEl.close()}
lbEl.addEventListener('close',()=>{document.body.style.overflow='';lbRunway.replaceChildren();lb.drag=null});
function move(delta){
  const d=byId.get(lb.sec);if(!d)return;
  const n=(d.covers||[]).length;const ni=lb.idx+delta;if(ni<0||ni>=n)return;
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
  if(e.key==='Escape'){e.preventDefault();closeLb()}
  else if(e.key==='ArrowLeft'){e.preventDefault();move(-1)}
  else if(e.key==='ArrowRight'){e.preventDefault();move(1)}
  else if(e.key==='Home'){e.preventDefault();move(-lb.idx)}
  else if(e.key==='End'){e.preventDefault();move(byId.get(lb.sec).covers.length-1-lb.idx)}
});