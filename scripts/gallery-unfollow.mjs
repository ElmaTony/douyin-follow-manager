import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { galleryPayload } from './core.mjs';
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

const cleanUrl = url => url.split('#')[0];
export async function attachGalleryUnfollow(context,paths, overrides={}) {
  const services={backgroundTab,verifyMain,processUnfollow,...overrides};
  const allowed = new Set(paths.map(p=>pathToFileURL(path.resolve(p)).href));
  let job = {running:false,rows:[],message:''};
  function snapshotMatches(stamp) {
    return JSON.parse(fs.readFileSync('data/snapshot_latest.json','utf8')).exported_at===stamp;
  }
  async function currentMarks(source,stamp,ids) {
    const tabs = [...new Set([source,...context.pages()])];
    for (const tab of tabs) {
      if (tab.isClosed() || !allowed.has(cleanUrl(tab.url()))) continue;
      const records = await tab.evaluate(({stamp,ids})=>{
        if (typeof snapshotAt==='undefined' || snapshotAt!==stamp) return null;
        const marks=readMarks();
        return ids.map(sec=>marks[sec]==='unf' ? recordFor(sec)?.rev || 'legacy' : null);
      },{stamp,ids}).catch(()=>null);
      if (records) return records;
    }
    return [];
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
        const stillPending=async()=> (await currentMarks(source,stamp,[item.sec_uid]))[0]===item.rev && snapshotMatches(stamp);
        if (!await stillPending()) Object.assign(job.rows[i],{code:'failed',detail:'标记已变化或画廊已关闭'});
        else Object.assign(job.rows[i],await services.processUnfollow(tab,item,{execute:true,stillPending}));
      }
    } catch(error) {
      job.message=/验证|大号身份异常|快照已更新|后台处理页/.test(error.message) ? error.message.split('\n')[0].slice(0,90) : '处理已中断，请检查网络和大号登录后重试';
      for (const row of job.rows) if (row.code==='working' || row.code==='waiting') Object.assign(row,{code:'failed',detail:'尚未确认，可重试'});
    } finally {
      if (tab) await tab.close().catch(()=>{});
      job.running=false;
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
      job={running:true,message:'',rows:items.map(d=>({sec:d.sec_uid,name:d.nickname,id:d.douyin_id,code:'waiting',detail:''}))};
      void run(page,input.stamp,items);
      return {accepted:true};
    } finally { starting=false; }
  });
}
