/** Headless end-to-end check. All Douyin requests are answered by this local fixture. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { CHROME } from './lib.mjs';
import { buildGallery } from './gallery.mjs';
import { currentOwner } from './account-checks.mjs';
import { processUnfollow } from './unfollow-action.mjs';
import { attachGalleryUnfollow } from './gallery-unfollow.mjs';

const original=process.cwd(), root=fs.mkdtempSync(path.join(os.tmpdir(),'guanxu-queue-'));
const stamp='2025-05-01T12:00:00.000Z';
const ids=['sample-a','sample-b','sample-c','protected'];
const authors=ids.map((sec,i)=>({sec_uid:sec,nickname:'示例作者 '+i,douyin_id:'demo'+i,works:1,times:[1740000000]}));
const live=new Set(ids),clicked=[];
const save=(name,value)=>fs.writeFileSync('data/'+name+'.json',JSON.stringify(value));
let context;
try {
  process.chdir(root); fs.mkdirSync('data');
  save('snapshot_latest',{exported_at:stamp,accounts:Object.fromEntries(authors.map(d=>[d.sec_uid,d]))});
  save('ban_latest',authors.map(d=>({sec_uid:d.sec_uid,status:'normal'})));
  save('suspects_latest',authors.map(d=>({sec_uid:d.sec_uid,renamed:true})));
  save('user_keep_list',{keeps:[authors[3]]});
  const files=[];
  for (const [kind,key] of [['stale','stale_state_v1'],['review','review_state_v2'],['suspect','suspect_state_v1']]) {
    const file=path.resolve('data/'+kind+'_gallery.html');
    const html=buildGallery({title:kind,date:stamp,snapshotAt:stamp,data:structuredClone(authors),key,rowKey:kind,
      filters:[{id:'all',label:'全部'}],protectedIds:['protected']});
    fs.writeFileSync(file,html);
    files.push(file);
  }
  context=await chromium.launchPersistentContext(path.join(root,'browser'),{executablePath:CHROME,headless:true,serviceWorkers:'block'});
  const filesForBridge = process.platform === 'win32'
    ? files.map(f => f[0].toLowerCase() + f.slice(1))
    : files;
  // A single context uses the same background-target mechanism as the desktop launcher.
  let activeOwner='fixture-owner';
  await attachGalleryUnfollow(context,filesForBridge,{
    verifyMain:async()=>{},
    processUnfollow:(page,item,options)=>processUnfollow(page,item,{...options,checkOwner:async page=>{
      if ((await currentOwner(page,{})).sec_uid!=='fixture-owner') throw new Error('大号身份异常，本批已暂停');
    }})
  });
  let allowB=false;
  await context.route(/^https?:/,async route=>{
    const u=new URL(route.request().url());
    if(u.origin!=='https://www.douyin.com') return route.abort();
    const id=u.searchParams.get('sec_user_id') || u.pathname.split('/').pop();
    if (u.pathname.includes('/profile/self/')) return route.fulfill({json:{status_code:0,user:{sec_uid:activeOwner}}});
    const d=authors.find(a=>a.sec_uid===id);
    if (!d) return route.fulfill({body:'fixture'});
    if(u.pathname==='/fixture-click') {
      clicked.push(id); live.delete(id); return route.fulfill({body:'ok'});
    }
    if(u.pathname.includes('/profile/other/')) return route.fulfill({json:{status_code:0,user:{...d,unique_id:d.douyin_id,follow_status:live.has(id)?(id==='sample-a'?2:1):0}}});
    const label=id==='sample-b' && !allowB?'关注':id==='sample-a'?'互相关注':'已关注';
    return route.fulfill({contentType:'text/html;charset=utf-8',body:'<title>'+d.nickname+'</title><p>抖音号：'+d.douyin_id+'</p><button data-e2e="user-info-follow-btn" onclick="fetch(\'/fixture-click?sec_user_id='+id+'\')">'+label+'</button>'});
  });
  const page=context.pages()[0];
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(files[0]).href);
  const mark=async id=>{ const b=page.locator('[data-sec="'+id+'"] [data-mark="unf"]'); await b.click();await page.waitForFunction(id=>readMarks()[id]==='unf',id); };
  for(const id of ids.slice(0,3)) await mark(id);
  await page.locator('#openQueue').click();
  assert.equal(await page.locator('#queueRows input').count(),3);
  assert.deepEqual(clicked,[]);
  await page.locator('#queueSelect').click();
  assert.ok(await page.locator('#queueConfirm').isDisabled());
  await page.locator('#queueSelect').click();
  assert.equal(await page.locator('#queueRows input:checked').count(),3);
  await page.locator('#queueRows input').nth(2).uncheck();
  await page.locator('#queueReturn').click();
  await page.locator('#openQueue').click();
  assert.equal(await page.locator('#queueRows input').nth(2).isChecked(),false,'重新核对时应保留已取消的勾选');
  const other=await context.newPage();
  await other.goto(pathToFileURL(files[1]).href);
  await other.locator('[data-sec="sample-b"] [data-mark="keep"]').click();
  await page.waitForFunction(()=>previewRows.length===2);
  await other.locator('[data-sec="sample-b"] [data-mark="unf"]').click();
  await page.waitForFunction(()=>previewRows.length===3);
  assert.equal(await page.locator('#queueRows input').nth(1).isChecked(),false,'名单打开时的新决定须重新勾选');
  assert.equal(await page.locator('#queueRows input').nth(2).isChecked(),false);
  await page.locator('#queueRows input').nth(1).check();
  await other.close();
  const stale=await page.evaluate(async()=>{
    try{await guanxuUnfollow('start',{stamp:snapshotAt,rows:[{sec:'sample-a',rev:'superseded'}]});}catch{return true;}return false;
  });
  assert.ok(stale);
  const before=JSON.parse(fs.readFileSync('data/snapshot_latest.json','utf8'));
  save('snapshot_latest',{...before,exported_at:'2025-05-02T12:00:00.000Z'});
  await page.locator('#queueConfirm').click();
  await page.waitForFunction(()=>document.getElementById('queueMessage').textContent.includes('快照已更新'));
  assert.equal(await page.locator('#queueRows input').nth(2).isChecked(),false);
  assert.deepEqual(clicked,[]);
  save('snapshot_latest',before);
  await page.locator('#queueConfirm').click();
  await page.locator('#queueReturn').click();
  await page.goto(pathToFileURL(files[2]).href);
  await page.locator('#openQueue').click();
  await page.waitForFunction(()=>!queueJob.running && queueJob.rows.length===2,null,{timeout:35000});
  assert.deepEqual(clicked,['sample-a']);
  assert.equal(await page.locator('#queueTitle').innerText(),'上批取关结果');
  await page.setViewportSize({width:320,height:650});
  assert.ok(await page.locator('#queue').evaluate(el=>el.scrollWidth<=el.clientWidth));
  await page.setViewportSize({width:1280,height:800});
  assert.ok((await page.locator('#queueRows').innerText()).includes('未找到已关注按钮'));
  assert.equal(await page.locator('[data-sec="sample-a"] .b-lock').count(),1);
  await page.locator('#queueConfirm').click();
  assert.equal(await page.locator('#queueRows input').count(),1,'只重试上批未完成的一位');
  assert.ok((await page.locator('#queueRows').innerText()).includes(authors[1].nickname));
  allowB=true;
  await page.locator('#queueConfirm').click();
  await page.waitForFunction(()=>!queueJob.running && queueJob.rows[0]?.sec==='sample-b' && queueJob.rows[0]?.code==='done',null,{timeout:25000});
  assert.deepEqual(clicked,['sample-a','sample-b']);
  await page.reload();
  await page.waitForFunction(()=>completed('sample-a') && completed('sample-b'));
  assert.deepEqual(await page.evaluate(()=>candidates().map(d=>d.sec_uid)),['sample-c']);
  const exported=await page.evaluate(()=>{document.getElementById('exportScope').value='combined';return decisionList();});
  assert.equal(exported.split('\t')[0],'sample-c');
  const registered=JSON.parse(fs.readFileSync('data/unfollow_registry.json'));
  assert.deepEqual(Object.keys(registered.entries),['sample-a','sample-b']);
  assert.equal(registered.entries['sample-a'].reason,'人工决定取关，已在线复核');
  activeOwner='fixture-other';
  await page.locator('#openQueue').click();
  const deferred=page.locator('#queueRows input');
  assert.equal(await deferred.isChecked(),false,'跨画廊和刷新应保留暂缓');
  await deferred.check();
  await page.locator('#queueConfirm').click();
  await page.waitForFunction(()=>!queueJob.running && queueJob.message.includes('大号身份异常'),null,{timeout:20000});
  assert.deepEqual(clicked,['sample-a','sample-b']);
  assert.ok(await page.evaluate(()=>candidates().some(d=>d.sec_uid==='sample-c')));
  const remote=await context.newPage();await remote.goto('https://www.douyin.com/');
  assert.ok(await remote.evaluate(async()=>{try{await guanxuUnfollow('status');return false;}catch{return true;}}));
  const lastFile='data/gallery_unfollow_last.json';
  const interrupted=JSON.parse(fs.readFileSync(lastFile));
  assert.equal(interrupted.running,false);
  assert.equal(interrupted.rows[0].code,'unverified');
  await context.close();
  async function reopen() {
    context=await chromium.launchPersistentContext(path.join(root,'browser'),{executablePath:CHROME,headless:true,serviceWorkers:'block'});
    await context.route(/^https?:/,route=>route.abort());
    await attachGalleryUnfollow(context,files);
    const tab=context.pages()[0];
    await tab.goto(pathToFileURL(files[0]).href);
    return tab;
  }
  let reopened=await reopen();
  await reopened.locator('#openQueue').click();
  assert.ok((await reopened.locator('#queueMessage').innerText()).includes('大号身份异常'),'关闭浏览器后保留上批结果');
  await context.close();
  const savedA=registered.entries['sample-a'];
  const originalC=interrupted.rows[0];
  // Model a stop between the durable receipt and the next batch checkpoint.
  const interruptedRows=[{sec:'sample-a',rev:savedA.review_revision,name:authors[0].nickname,id:authors[0].douyin_id,code:'working'},
    {...originalC,code:'waiting',detail:''}];
  save('gallery_unfollow_last',{running:true,startedAt:stamp,stamp,rows:interruptedRows,message:''});
  reopened=await reopen();
  await reopened.locator('#openQueue').click();
  const recovered=await reopened.evaluate(()=>guanxuUnfollow('status'));
  assert.deepEqual(recovered.rows.map(d=>d.code),['absent','unstarted']);
  assert.equal(recovered.running,false);
  await reopened.locator('#queueConfirm').click();
  assert.deepEqual(await reopened.evaluate(()=>previewRows.map(d=>d.sec_uid)),['sample-c']);
  assert.deepEqual(clicked,['sample-a','sample-b']);
  assert.deepEqual(errors,[]);
  console.log('画廊内确认、跨页进度、排除与去重、过期标记、部分失败重试、登记与导出通过');
} finally {
  if(context) await context.close();
  process.chdir(original);
  if(path.dirname(root)===path.resolve(os.tmpdir()) && path.basename(root).startsWith('guanxu-queue-')) fs.rmSync(root,{recursive:true,force:true});
}
