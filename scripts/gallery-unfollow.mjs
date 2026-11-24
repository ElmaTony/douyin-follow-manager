import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { galleryPayload, writeJson } from './core.mjs';
import { sleep } from './lib.mjs';
import { processUnfollow, verifyMain, readRegistry, protectedAccounts } from './unfollow-action.mjs';

async function backgroundTab(context,source) {
  const session = await context.newCDPSession(source);
  try {
    const {targetId} = await session.send('Target.createTarget',{url:'about:blank',background:true});
    for (let i=0;i<40;i++) {
      for (const page of context.pages().filter(p=>p.url()==='about:blank')) {
        const tab = await context.newCDPSession(page);
        try { if ((await tab.send('Target.getTargetInfo')).targetInfo.targetId===targetId) return page; }
        finally { await tab.detach(); }
      }
      await sleep(50);
    }
    await session.send('Target.closeTarget',{targetId});
    throw new Error('无法打开后台处理页');
  } finally { await session.detach(); }
}

const lastBatchFile='data/gallery_unfollow_last.json';
const emptyBatch=()=>({running:false,rows:[],message:''});

function restoreBatch() {
  if (!fs.existsSync(lastBatchFile)) return emptyBatch();
  const batch=JSON.parse(fs.readFileSync(lastBatchFile,'utf8'));
  if (!Array.isArray(batch.rows)) throw new Error('上批取关结果无法读取');
  if (!batch.running) return batch;
  const entries=readRegistry().entries;
  for (const row of batch.rows) {
    if (row.code==='waiting') Object.assign(row,{code:'unstarted',detail:'中断前尚未开始'});
    if (row.code!=='working') continue;
    const receipt=entries[row.sec];
    if (receipt?.review_revision===row.rev && Date.parse(receipt.verified_at)>=Date.parse(batch.startedAt)) {
      Object.assign(row,{code:'absent',detail:'已核实未关注，登记已找回'});
    } else Object.assign(row,{code:'unverified',detail:'上次核对中断，须在线复核'});
  }
  Object.assign(batch,{running:false,message:'上批处理中断。可核对未完成项并重新确认。'});
  writeJson(lastBatchFile,batch);
  return batch;
}

const cleanUrl = url => url.split('#')[0];
export async function attachGalleryUnfollow(context,paths, overrides={}) {
  const services={backgroundTab,verifyMain,processUnfollow,...overrides};
  const allowed = new Set(paths.map(p=>pathToFileURL(path.resolve(p)).href));
  let job=restoreBatch(), snapshotSignature, snapshotAtOnDisk;
  const checkpoint=()=>writeJson(lastBatchFile,job);
  function snapshotMatches(stamp) {
    const file='data/snapshot_latest.json';
    const st=fs.statSync(file,{bigint:true});
    const signature=[st.ino,st.size,st.mtimeNs,st.ctimeNs].join(':');
    if (signature!==snapshotSignature) {
      snapshotAtOnDisk=JSON.parse(fs.readFileSync(file,'utf8')).exported_at;
      snapshotSignature=signature;
    }
    return snapshotAtOnDisk===stamp;
  }
  async function currentMarks(source,stamp,ids) {
    // A same-tab gallery link briefly replaces the document during navigation.
    for (let attempt=0;attempt<6;attempt++) {
      const tabs=[...new Set([source,...context.pages()])];
      for (const tab of tabs) {
        if (tab.isClosed() || !allowed.has(cleanUrl(tab.url()))) continue;
        const records=await tab.evaluate(({stamp,ids})=>{
          if (typeof snapshotAt==='undefined' || snapshotAt!==stamp) return null;
          const marks=readMarks(ids);
          return ids.map(sec=>marks[sec]==='unf' ? recordFor(sec)?.rev || 'legacy' : null);
        },{stamp,ids}).catch(()=>null);
        if (records) return records;
      }
      if (attempt<5) await sleep(150);
    }
    throw new Error('画廊已关闭或正在更新，请重新打开后核对');
  }
  function receipts() {
    return Object.fromEntries(Object.entries(readRegistry().entries).filter(([,e])=>e.verified_at)
      .map(([id,e])=>[id,{at:e.verified_at,rev:e.review_revision}]));
  }
  async function run(source,stamp,items) {
    let tab;
    try {
      tab = await services.backgroundTab(context,source);
      await services.verifyMain(tab);
      for (const [i,item] of items.entries()) {
        if (!snapshotMatches(stamp)) throw new Error('快照已更新，请重新打开画廊核对');
        job.rows[i].code='working';
        checkpoint();
        const stillPending=async()=> (await currentMarks(source,stamp,[item.sec_uid]))[0]===item.rev && snapshotMatches(stamp);
        if (!await stillPending()) Object.assign(job.rows[i],{code:'failed',detail:'标记已变化或画廊已关闭'});
        else Object.assign(job.rows[i],await services.processUnfollow(tab,item,{execute:true,stillPending}));
        checkpoint();
      }
    } catch(error) {
      job.message=/验证|大号身份异常|快照已更新|后台处理页|画廊已关闭/.test(error.message) ? error.message.split('\n')[0].slice(0,90) : '处理已中断，请检查网络和大号登录后重试';
      for (const row of job.rows) {
        if (row.code==='working') Object.assign(row,{code:'unverified',detail:'本次处理未能核实'});
        if (row.code==='waiting') Object.assign(row,{code:'unstarted',detail:'尚未开始'});
      }
    } finally {
      if (tab) await tab.close().catch(()=>{});
      job.running=false;
      try { checkpoint(); } catch { job.message='本批结果未能写入本机，请检查可用空间。'; }
    }
  }
  let starting=false;
  await context.exposeBinding('guanxuUnfollow',async ({frame,page},action,input)=>{
    const caller=cleanUrl(frame.url());
    if (frame!==page.mainFrame() || !allowed.has(caller)) throw new Error('请从关序工作台打开画廊');
    if (action==='status') return {...job,receipts:receipts()};
    if (action!=='start' || starting || job.running) throw new Error('已有取关任务，请查看进度');
    starting=true;
    try {
      const payload=galleryPayload(fs.readFileSync(fileURLToPath(caller),'utf8'));
      if (payload.snapshotAt!==input?.stamp || !snapshotMatches(payload.snapshotAt)) throw new Error('快照已更新，请刷新画廊');
      const selected=input.rows;
      if (!Array.isArray(selected) || !selected.length || selected.length>payload.union.length) throw new Error('本批名单无效，请重新核对');
      const ids=selected.map(r=>r.sec), eligible=new Map(payload.union.map(d=>[d.sec_uid,d]));
      if (new Set(ids).size!==ids.length) throw new Error('名单重复，请重新核对');
      const marks=await currentMarks(page,input.stamp,ids);
      const locked=protectedAccounts(), verified=receipts();
      const items=selected.map(({sec,rev},i)=>{
        const author=eligible.get(sec),receipt=verified[sec];
        if (!author || !author.nickname || !author.douyin_id || locked.has(sec) || !rev || marks[i]!==rev ||
            (receipt && (Date.parse(receipt.at)>=Date.parse(input.stamp) || receipt.rev===rev)))
          throw new Error('名单或标记已变化，请重新核对');
        return {...author,rev};
      });
      const next={running:true,stamp:input.stamp,startedAt:new Date().toISOString(),message:'',
        rows:items.map(d=>({sec:d.sec_uid,name:d.nickname,id:d.douyin_id,rev:d.rev,code:'waiting',detail:''}))};
      writeJson(lastBatchFile,next);
      job=next;
      void run(page,input.stamp,items);
      return {accepted:true};
    } finally { starting=false; }
  });
}
