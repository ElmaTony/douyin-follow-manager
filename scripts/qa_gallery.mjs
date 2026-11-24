/** 无登录浏览器复测。--offline 阻止联网，加 --keep-screenshots 可将截图保存在所测画廊目录下。 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { attachProfileTab } from './profile-tab.mjs';
import { CHROME, DATA } from './lib.mjs';

const args = process.argv.slice(2);
const offline = args.includes('--offline');
const target = path.resolve(args.find(arg => !arg.startsWith('--')) || path.join(DATA, 'suspect_gallery.html'));
const galleryDir = path.dirname(target);
const output = args.includes('--keep-screenshots') ? await fs.mkdtemp(path.join(galleryDir, '.gallery-qa-')) : null;
const url = file => pathToFileURL(file).href;
async function settleDecisions(page) {
  await page.waitForFunction(async()=>{
    const {held,pending}=await navigator.locks.query();
    return ![...held,...pending].some(lock=>lock.name.startsWith(decisionPrefix));
  });
}
const browser = await chromium.launch({ executablePath: CHROME, headless: !args.includes('--headed') });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  if (offline) await context.route(/^https?:/, route => route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const click = async selector => {
    await page.locator(selector).first().click();
    if (['#undo','#lbKeep','.card .b-keep'].includes(selector)) await settleDecisions(page);
  };
  const fits = async () => assert.ok(await page.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth), '页面超出视口');
  const files = new Set(['review_gallery.html', 'stale_gallery.html', 'suspect_gallery.html'].map(f => path.join(galleryDir, f)));
  for (const file of files) {
    await page.goto(url(file), { waitUntil: 'domcontentloaded' });
    await page.evaluate(()=>{ localStorage.clear(); sessionStorage.clear(); });
    await page.reload({waitUntil:'domcontentloaded'});
    const cfg = await page.locator('#gallery-data').evaluate(el => JSON.parse(el.textContent));
    const cards = page.locator('.card');
    assert.equal(await cards.count(), cfg.data.length);
    assert.equal(await page.locator('nav [aria-current="page"]').count(), 1);
    assert.equal(await page.locator('[data-f][aria-pressed=true]').getAttribute('data-f'), 'all');
    for (const f of cfg.filters) await click('[data-f="'+f.id+'"]');
    await click('[data-f="all"]');
    const protectedCount = cfg.data.filter(d => d.badgeFix || cfg.protectedIds.includes(d.sec_uid)).length;
    assert.equal(await page.locator('.b-lock:disabled').count(), protectedCount);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({width, height:900});
      await fits();
    }
    await page.locator('#multiOnly').check();
    assert.equal(await cards.count(),cfg.data.filter(d=>d.alsoIn?.length).length);
    await page.locator('#multiOnly').uncheck();
    if (await page.locator('#changedOnly').isEnabled()) {
      await page.locator('#changedOnly').check();
      assert.equal(await cards.count(),cfg.data.filter(d=>d.changes?.length).length);
      await page.locator('#changedOnly').uncheck();
    }
    const withWork = cfg.data.find(d=>d.posts?.some(p=>p.cover && /^\d+$/.test(p.id)));
    if (withWork) {
      const node = page.locator('.card[data-sec="'+withWork.sec_uid+'"]');
      await node.locator('summary').click();
      await node.locator('.works ol li').first().waitFor();
      assert.equal(await node.locator('.works ol li').count(),withWork.posts.length);
      const refs=withWork.posts.filter(p=>/^\d+$/.test(p.id));
      assert.equal(await node.locator('.works ol li a').count(),refs.length);
      await node.locator('summary').click();
      const firstCover=withWork.posts.find(p=>p.cover);
      await node.locator('.cover').first().click();
      assert.ok((await page.locator('#lbAttr').innerText()).includes(firstCover.caption));
      if (/^\d+$/.test(firstCover.id)) assert.ok((await page.locator('#lbWork').getAttribute('href')).endsWith('/'+firstCover.id));
      await page.keyboard.press('Escape');
    }
    const reviewIndex=cfg.data.findIndex(d=>d.covers?.length && !d.badgeFix && !cfg.protectedIds.includes(d.sec_uid) && !cfg.presetKeep.includes(d.sec_uid));
    if (reviewIndex>=0) {
      const reviewer=cfg.data[reviewIndex];
      const nextAuthor=[...cfg.data.slice(reviewIndex+1),...cfg.data.slice(0,reviewIndex)].find(d=>
        d.covers?.length && !d.badgeFix && !cfg.protectedIds.includes(d.sec_uid) && !cfg.presetKeep.includes(d.sec_uid));
      await page.locator('.card[data-sec="'+reviewer.sec_uid+'"] .cover').first().click();
      const manualBefore=await page.evaluate(()=>readMarks());
      await click('#lbKeep');
      const manualAfter=await page.evaluate(()=>readMarks());
      assert.deepEqual(manualAfter,{...manualBefore,[reviewer.sec_uid]:'keep'},'一次决定只保存一个账号');
      assert.equal(await page.evaluate(id=>readMarks()[id],reviewer.sec_uid),'keep');
      if(nextAuthor) {
        assert.equal(await page.locator('#lbWho').textContent(),nextAuthor.nickname);
        await page.keyboard.press('Escape');
      }
      await click('#undo');
      assert.equal(await page.locator('.card[data-sec="'+reviewer.sec_uid+'"] .b-keep').getAttribute('aria-pressed'),'false');
    }
    const crossing=cfg.data.find(d=>d.alsoIn?.length);
    if (crossing) {
      const crossLink=page.locator('.card[data-sec="'+crossing.sec_uid+'"] .other-gallery').first();
      const destination=new URL(await crossLink.getAttribute('href'),url(file)); destination.hash='';
      await page.goto(destination.href,{waitUntil:'domcontentloaded'});
      const targetKey=await page.locator('#gallery-data').evaluate(el=>JSON.parse(el.textContent).rowKey);
      await page.locator('#search').fill('');
      await page.locator('#markFilter').selectOption('none');
      const expectedCursor=(await cards.count())>5 ? 5 : 0;
      await page.evaluate(({k,n})=>localStorage.setItem(k,String(n)),{k:targetKey,n:expectedCursor});
      await page.goto(url(file),{waitUntil:'domcontentloaded'});
      await crossLink.click();
      await page.waitForFunction(id=>document.querySelector('#search').value===id,crossing.sec_uid);
      assert.equal(await cards.count(),1);
      assert.equal(await cards.first().getAttribute('data-sec'),crossing.sec_uid);
      assert.equal(await page.evaluate(k=>localStorage.getItem(k),targetKey),String(expectedCursor));
      await click('#returnToList');
      assert.equal(new URL(page.url()).hash,'');
      assert.equal(await page.locator('#markFilter').inputValue(),'none');
      assert.equal(await page.locator('#search').inputValue(),'');
      if (expectedCursor) assert.match(await page.locator('#rowPos').textContent(),/6–/);
      await page.locator('#markFilter').selectOption('all');
      await page.goto(url(file),{waitUntil:'domcontentloaded'});
    }
    await page.locator('#markFilter').selectOption('none-no-cover');
    const marked=await page.evaluate(()=>readMarks());
    assert.equal(await cards.count(),cfg.data.filter(d=>!d.covers?.length && !d.badgeFix && !cfg.protectedIds.includes(d.sec_uid) &&
      !cfg.presetKeep.includes(d.sec_uid) && !marked[d.sec_uid]).length);
    await page.locator('#markFilter').selectOption('all');
    await page.locator('#search').fill('____empty____');
    assert.equal(await cards.count(), 0);
    assert.equal(await page.locator('#btnRow').isDisabled(), true);
    await page.locator('#search').fill('');
    const first = cfg.data.find(d => !d.badgeFix && !cfg.protectedIds.includes(d.sec_uid));
    if (!first) continue;
    const row = page.locator('.card[data-sec="'+first.sec_uid+'"]');
    await page.evaluate(({key, sec}) => localStorage.setItem(key, JSON.stringify({[sec]:'keep'})), {key:cfg.key, sec:first.sec_uid});
    await page.reload({waitUntil:'domcontentloaded'});
    assert.equal(await row.locator('.b-keep').getAttribute('aria-pressed'), 'true');
    await row.locator('.b-unf').click(); await settleDecisions(page);
    await page.reload({waitUntil:'domcontentloaded'});
    assert.equal(await row.locator('.b-unf').getAttribute('aria-pressed'), 'true');
    await page.locator('#markFilter').selectOption('none');
    const before = await cards.count();
    if (before) {
      await click('.card .b-keep');
      assert.equal(await cards.count(), before - 1);
    }
    await page.locator('#markFilter').selectOption('unf');
    assert.ok(await row.isVisible());
    if (before) {
      await click('#undo');
      assert.ok(await row.isVisible());
      await page.locator('#markFilter').selectOption('none');
      assert.equal(await cards.count(),before);
    }
    await page.locator('#markFilter').selectOption('all');
    const ids = () => cards.evaluateAll(nodes => nodes.map(node => node.dataset.sec));
    const unlocked = d => !d.badgeFix && !cfg.protectedIds.includes(d.sec_uid);
    if (cfg.groups.length) {
      await page.locator('#sortOrder').selectOption('oldest');
      assert.deepEqual(await ids(),[...cfg.data].sort((a,b)=>b.gap-a.gap).map(d=>d.sec_uid));
      await click('[data-f="s180"]');
      await page.locator('#markFilter').selectOption('none');
      const marks = await page.evaluate(()=>readMarks());
      assert.deepEqual(await ids(),cfg.data.filter(d=>d.group==='s180' && unlocked(d) && !cfg.presetKeep.includes(d.sec_uid) && !marks[d.sec_uid]).sort((a,b)=>b.gap-a.gap).map(d=>d.sec_uid));
    } else if (cfg.key === 'review_state_v2') {
      await click('[data-f="few"]');
      assert.deepEqual(await ids(),cfg.data.filter(d=>unlocked(d) && d.works>=1 && d.works<=5).map(d=>d.sec_uid));
    } else {
      await click('[data-f="renamed"]');
      const renamed=cfg.data.find(d=>d.renamed && d.previousName);
      if(renamed){
        await page.locator('#search').fill(renamed.previousName);
        assert.ok((await ids()).includes(renamed.sec_uid));
        await page.reload({waitUntil:'domcontentloaded'});
        assert.equal(await page.locator('#search').inputValue(),renamed.previousName);
        assert.equal(await page.locator('[data-f="renamed"]').getAttribute('aria-pressed'),'true');
        await page.locator('#search').fill('');
      }
      await click('[data-f="shift"]');
      assert.deepEqual(await ids(),cfg.data.filter(d=>d.contentShift).map(d=>d.sec_uid));
    }
    await page.locator('#markFilter').selectOption('all');
    await page.locator('#sortOrder').selectOption('default');
    await page.evaluate(() => {
      window.qaLinks = [];
      Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText: async text => {window.qaCopy = text;}}});
      window.open = () => ({opener:null, location:{replace: link => window.qaLinks.push(link)}});
    });
    await click('[data-f="all"]');
    if (await page.locator('#btnRowReset').isEnabled()) await click('#btnRowReset');
    await click('#btnRow'); assert.equal(await page.evaluate(() => window.qaLinks.length), Math.min(cfg.data.length,5));
    await page.locator('#search').fill(first.sec_uid);
    assert.equal(await cards.count(),1);
    if (await page.locator('#btnRowReset').isEnabled()) await click('#btnRowReset');
    await page.evaluate(() => {window.open = () => null; navigator.clipboard.writeText = async()=>{throw Error('denied')};});
    await click('#btnRow');
    assert.ok(await page.locator('#btnRow').isEnabled(),'复制失败仍可重试');
    await page.evaluate(() => { navigator.clipboard.writeText = async text=>{window.qaCopy=text}; });
    await click('#btnRow');
    assert.ok((await page.evaluate(() => window.qaCopy)).includes('/user/'));
    assert.ok(await page.locator('#btnRow').isDisabled(),'已交付的链接应推进浏览进度');
    await click('#btnCopy');
    const filtered = await page.evaluate(()=>window.qaCopy);
    assert.equal(filtered.split('\n').length,1);
    assert.ok(filtered.startsWith(first.sec_uid+'\t') && filtered.endsWith('\t取关'));
    await page.locator('#search').fill('____no_results____');
    assert.ok(await page.locator('#btnDown').isDisabled() && await page.locator('#btnCopy').isDisabled());
    await click('#clearFilters');
    assert.equal(await cards.count(),cfg.data.length);
    await page.locator('#search').fill(first.sec_uid);
    await page.locator('#exportScope').selectOption('all');
    await click('#btnCopy');
    const copied = await page.evaluate(() => window.qaCopy);
    assert.equal(copied.split('\n').length, cfg.data.length - protectedCount);
    assert.ok(!copied.split('\n').some(line => cfg.protectedIds.includes(line.split('\t')[0])));
    const [download] = await Promise.all([page.waitForEvent('download'), click('#btnDown')]);
    assert.match(download.suggestedFilename(),/^decisions-.+-整个画廊-快照.+-导出[\d-]+_\d{6}\.txt$/);
    assert.equal(await fs.readFile(await download.path(), 'utf8'), copied);
    console.log(path.basename(file), '列表 / 四种宽度 / 标记恢复 / 筛选 / 导出 / 批量浏览通过');
  }

  await page.goto(url(target), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const cfg = JSON.parse(document.getElementById('gallery-data').textContent);
    localStorage.removeItem(cfg.key);
    localStorage.removeItem(cfg.rowKey);
  });
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('.card').first().waitFor();
  if (output) await page.screenshot({path:path.join(output, 'qa_gallery.png')});
  await page.emulateMedia({colorScheme:'dark'});
  await page.setViewportSize({width:390,height:844});
  await fits();
  if (offline && output) await page.screenshot({path:path.join(output, 'mobile-dark.png')});
  await page.emulateMedia({colorScheme:'light'});
  await page.setViewportSize({width:1440,height:900});
  const cover = page.locator('.card:has(.cover:nth-child(2)) .cover').first();
  await cover.click();
  assert.ok(await page.locator('#lb').evaluate(el => el.open));
  await page.keyboard.press('ArrowRight');
  assert.match(await page.locator('#lbPos').textContent(), /^2 \//);
  await page.keyboard.press('End');
  assert.ok(await page.locator('#lbNext').isDisabled());
  await page.keyboard.press('Home');
  assert.ok(await page.locator('#lbPrev').isDisabled());
  if (output) await page.screenshot({path:path.join(output, 'qa_lightbox.png')});
  if (offline) {
    // 本地图像只用于尺寸、缩放和键盘回归，截图保留实际缺图状态。
    await page.locator('.slide img.active').evaluate(async img => {
      const canvas = document.createElement('canvas');
      canvas.width = 360; canvas.height = 640;
      img.src = canvas.toDataURL(); await img.decode(); img.hidden = false;
      img.parentElement.querySelector('.missing').hidden = true;
    });
    await page.locator('.slide img.active').dblclick();
    assert.ok(await page.locator('#lbZoom').isVisible());
    await page.locator('.slide img.active').dblclick();
    assert.ok(!await page.locator('#lbZoom').isVisible());
  }
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#lb').evaluate(el => el.open), false);
  assert.ok(await cover.evaluate(el => el === document.activeElement));
  assert.deepEqual(errors, []);
  if (offline) { await checkLongReview(browser); await checkProfileTab(browser); await checkCrossDecisions(browser); }

  console.log('灯箱 / 键盘 / 深色布局通过');
  if (output) console.log('截图目录',output);
} finally {
  await browser.close();
}

async function checkLongReview(browser) {
  const context=await browser.newContext({viewport:{width:1280,height:880}});
  try {
    await context.route(/^https?:/,r=>r.request().resourceType()==='document' ?
      r.fulfill({contentType:'text/html',body:'<title>Profile link test</title>'}) : r.abort());
    const page=await context.newPage();
    const names=['review_gallery.html','stale_gallery.html','suspect_gallery.html'];
    const href=name=>url(path.join(galleryDir,name));
    const navigate=async name=>{
      await Promise.all([page.waitForURL(href(name)),page.locator('nav a[href="'+name+'"]').click()]);
      await page.locator('#content').waitFor();
    };
    await page.goto(href(names[0]));
    const cfg=await page.locator('#gallery-data').evaluate(e=>JSON.parse(e.textContent));
    const editable=cfg.data.filter(d=>d.covers?.length && !d.badgeFix && !cfg.protectedIds.includes(d.sec_uid) && !cfg.presetKeep.includes(d.sec_uid));
    const author=editable.find(d=>d.covers.length>=2 && d.alsoIn?.length);
    if (!author || editable.length<3) return;
    const marks=()=>page.evaluate(()=>readMarks());
    const row=page.locator('.card[data-sec="'+author.sec_uid+'"]');
    await row.locator('.cover').nth(1).click();
    const [profilePage]=await Promise.all([context.waitForEvent('page'), page.locator('#lbProfile').click()]);
    await profilePage.waitForLoadState();
    assert.ok(profilePage.url()==='https://www.douyin.com/user/'+author.sec_uid && await profilePage.evaluate(()=>window.opener===null));
    await profilePage.close();
    assert.match(await page.locator('#lbPos').textContent(),/^2 /);
    await page.locator('#lbUnf').dblclick(); await settleDecisions(page);
    assert.equal(Object.keys(await marks()).length,1,'双击只能标记一位');
    await page.locator('#lbUndo').click(); await settleDecisions(page);
    assert.deepEqual(await marks(),{});
    assert.ok(await page.locator('#lbProfile').getAttribute('data-profile')===author.sec_uid);
    assert.match(await page.locator('#lbPos').textContent(),/^2 /);
    await page.locator('#lbSkip').click();
    assert.deepEqual(await marks(),{});
    const run=Math.min(editable.length-2,12);
    for(let i=0;i<run;i++) { await page.locator('#lbKeep').click(); await settleDecisions(page); }
    assert.equal(Object.keys(await marks()).length,run);
    if(await page.locator('#lb').isVisible()) await page.keyboard.press('Escape');
    const anchor=page.locator('.card').nth(Math.floor(cfg.data.length/2));
    await anchor.evaluate(e=>e.scrollIntoView({block:'center'}));
    const y=await page.evaluate(()=>scrollY);
    for(const name of [names[1],names[2],names[0]]) await navigate(name);
    assert.ok(Math.abs(await page.evaluate(()=>scrollY)-y)<12,'返回画廊应恢复阅读位置');
    assert.ok(await page.locator('#undo').isEnabled());
    await page.locator('#undo').click(); await settleDecisions(page);
    assert.equal(Object.keys(await marks()).length,run-1);
    await row.locator('.other-gallery').first().click();
    await page.waitForFunction(()=>document.querySelector('#backToSource')?.hidden===false);
    assert.ok(await page.locator('.card .plink').first().textContent()==='再看主页 ↗');
    await page.locator('#batchSize').selectOption('1');
    assert.ok(await page.locator('#btnRow').isDisabled(),'跨画廊跳过已打开过的主页');
    await page.locator('#backToSource').click();
    await page.waitForURL(href(names[0]));
    assert.equal(await page.locator('#batchSize').inputValue(),'1');
    console.log('三画廊往返、连续审阅 '+run+' 位、双击防误标、原作位置撤销、主页独立标签页与跨画廊去重复测通过');
  } finally { await context.close(); }
}

async function checkProfileTab(browser) {
  const ctx=await browser.newContext();
  try {
    const files=['review_gallery.html','stale_gallery.html','suspect_gallery.html'].map(name=>path.join(galleryDir,name));
    await attachProfileTab(ctx,files);
    await ctx.route(/^https?:/,r=>r.request().resourceType()==='document' ?
      r.fulfill({contentType:'text/html',body:'<title>Example profile</title>'}) : r.abort());
    const gallery=await ctx.newPage(); await gallery.goto(url(files[0]));
    const links=gallery.locator('.plink');
    if (await links.count()<3) return;
    await gallery.locator('#reuseProfile').check();
    const href=async i=>links.nth(i).getAttribute('href');
    const firstUrl=await href(0);
    const [tab]=await Promise.all([ctx.waitForEvent('page'),links.first().click()]);
    await tab.waitForURL(firstUrl);
    assert.ok(await tab.evaluate(()=>window.opener===null));
    await gallery.waitForFunction(()=>document.querySelector('.plink').textContent.includes('再看'));
    await gallery.bringToFront();
    await gallery.locator('#batchSize').selectOption('1');
    const secondUrl=await href(1);
    await gallery.locator('#btnRow').click();
    await tab.waitForURL(secondUrl);
    assert.equal(ctx.pages().length,2,'连续打开两位应共用同一页');
    assert.equal(await tab.evaluate(()=>window.guanxuOpenProfile('example')),false,'外部页面不能操作专用标签页');
    const [separate]=await Promise.all([ctx.waitForEvent('page'),links.first().click({modifiers:['Control']})]);
    await separate.waitForURL(firstUrl);
    assert.equal(ctx.pages().length,3,'Ctrl 单击应保留对照页');
    await separate.close();
    await tab.goto(secondUrl+'?modal_id=1');
    const thirdUrl=await href(2);
    const [newTab]=await Promise.all([ctx.waitForEvent('page'),links.nth(2).click()]);
    await newTab.waitForURL(thirdUrl);
    assert.ok(tab.url().endsWith('?modal_id=1'),'应保留用户正在看的作品页');
    await newTab.close();
    const [reopened]=await Promise.all([ctx.waitForEvent('page'),links.first().click()]);
    await reopened.waitForURL(firstUrl);
    console.log('专用主页标签页复用、关闭后再开、保留独立浏览内容通过');
  } finally { await ctx.close(); }
}

// Exercise decisions through cards and downloaded files. Use a fresh browser profile for every run.
async function checkCrossDecisions(browser) {
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  try {
    await context.route(/^https?:/,route=>route.abort());
    const page=await context.newPage();
    const gallery=name=>url(path.join(galleryDir,name+'_gallery.html'));
    const names=['review','stale','suspect'];
    const configs=[];
    for(const name of names) {
      await page.goto(gallery(name));
      configs.push(await page.locator('#gallery-data').evaluate(el=>JSON.parse(el.textContent)));
    }
    const indices=configs.map(c=>new Map(c.data.map(d=>[d.sec_uid,d])));
    const unionIds=configs[0].union.map(d=>d.sec_uid);
    assert.equal(new Set(unionIds).size,unionIds.length);
    const eligible=new Set(unionIds), allIds=new Set(indices.flatMap(m=>[...m.keys()]));
    for(const cfg of configs) assert.ok(JSON.stringify(cfg.union)===JSON.stringify(configs[0].union),'三个画廊的联合导出范围应相同');
    for(const sec of allIds) {
      const locations=indices.map((m,i)=>m.has(sec)?i:-1).filter(i=>i>=0);
      for(const i of locations) {
        const row=indices[i].get(sec);
        const other=locations.filter(j=>j!==i).map(j=>names[j]+'_gallery.html').sort();
        assert.ok(JSON.stringify(other)===JSON.stringify(row.alsoIn.map(a=>a.href).sort()) && row.alsoIn.every(a=>a.note),'归类理由和双向入口必须与实际成员一致');
        assert.equal(eligible.has(sec),!row.badgeFix && !configs[i].protectedIds.includes(sec),'同一博主的可操作状态应一致');
      }
    }
    const choices=unionIds.filter(sec=>indices[0].has(sec) && !configs[0].presetKeep.includes(sec));
    const sec=choices.find(id=>indices.every(m=>m.has(id))) || choices.find(id=>indices.slice(1).some(m=>m.has(id)));
    if (!sec) {console.log('没有可操作的交集账号，已核对分类与保护范围');return;}
    const dest=indices.findIndex((m,i)=>i>0 && m.has(sec));
    const alt=unionIds.find(id=>id!==sec && indices[dest].has(id) && !configs[0].presetKeep.includes(id));
    const card=(p,id)=>p.locator('.card[data-sec="'+id+'"]');
    const mark=async(p,id,value)=>{await card(p,id).locator('[data-mark="'+value+'"]').click(); await settleDecisions(p);};
    const has=(p,id,value)=>p.waitForFunction(({id,value})=>markOf(id)===value,{id,value});
    const undo=async p=>{await p.locator('#undo').click(); await settleDecisions(p);};
    const rows=async(p,scope)=>{
      await p.locator('#exportScope').selectOption(scope);
      const [download]=await Promise.all([p.waitForEvent('download'),p.locator('#btnDown').click()]);
      const text=await fs.readFile(await download.path(),'utf8');
      const list=text.split('\n').map(line=>line.split('\t'));
      const summary=await p.locator('#exportSummary').textContent();
      const totals=Object.fromEntries([...summary.matchAll(/(取关|保留|未审|待复核) (\d+)/g)].map(m=>[m[1],Number(m[2])]));
      for (const label of ['取关','保留','未审','待复核']) assert.equal(totals[label]||0,list.filter(row=>row[3]===label).length);
      if (scope==='combined') assert.ok(download.suggestedFilename().includes('三个画廊已标记'));
      assert.ok(list.every(row=>row.length===4));
      assert.equal(new Set(list.map(r=>r[0])).size,list.length,'同一份名单不能重复出现博主');
      return new Map(list.map(r=>[r[0],r[3]]));
    };
    await page.goto(gallery('review'));
    await mark(page,sec,'unf');
    await card(page,sec).locator('a[href^="'+names[dest]+'_gallery.html"]').click();
    await page.locator('#backToSource').waitFor();
    assert.equal(await card(page,sec).locator('.b-unf').getAttribute('aria-pressed'),'true');
    assert.equal((await rows(page,'visible')).get(sec),'取关');
    await undo(page); await has(page,sec,'');
    assert.equal((await rows(page,'visible')).get(sec),'未审');
    await mark(page,sec,'keep');
    if (indices.every(m=>m.has(sec))) {
      const third=names.find((_,i)=>i!==0 && i!==dest);
      await card(page,sec).locator('a[href^="'+third+'_gallery.html"]').click();
      await page.locator('#backToSource').waitFor();
      assert.equal((await rows(page,'visible')).get(sec),'保留');
      await page.locator('#backToSource').click();
      await page.waitForURL(u=>u.pathname.endsWith(names[dest]+'_gallery.html') && u.hash.includes('account='));
      assert.equal((await rows(page,'visible')).get(sec),'保留');
    }
    await page.locator('#backToSource').click();
    await has(page,sec,'keep');
    await undo(page); await has(page,sec,'');
    const unrelated=choices.find(id=>id!==sec);
    if (unrelated) {
      await mark(page,unrelated,'keep');
      await card(page,sec).locator('a[href^="'+names[dest]+'_gallery.html"]').click();
      await page.locator('#backToSource').waitFor();
      assert.ok(await page.locator('#undo').isDisabled(),'定位单个博主时不能撤销旁人的决定');
      await page.locator('#backToSource').click();
      await undo(page);
    }

    await page.goto(gallery(names[dest])+'#account=missing-fictional-account&from=review_gallery.html&at=old');
    await page.locator('#backToSource').waitFor();
    assert.equal(await page.locator('.card').count(),0);
    assert.ok(await page.locator('#linkNotice').isVisible() && await page.locator('#btnDown').isDisabled());
    await page.locator('#backToSource').click();
    const second=await context.newPage(); await second.goto(gallery(names[dest]));
    // Two old galleries disagree. Refreshing or switching pages must never choose an unfollow.
    await page.evaluate(id=>{
      localStorage.setItem('review_state_v2',JSON.stringify({[id]:'unf'}));
      localStorage.setItem('stale_state_v1',JSON.stringify({[id]:'keep'}));
    },sec);
    await page.reload(); await has(second,sec,'conflict');
    await page.locator('#conflicts').click();
    assert.equal(await page.locator('.card').count(),1);
    assert.ok((await card(page,sec).innerText()).includes('低作品：取关，停更：保留'));
    const conflicted=await rows(page,'visible'); assert.equal(conflicted.get(sec),'待复核');
    await page.locator('#exportScope').selectOption('combined');
    if (await page.locator('#btnDown').isEnabled()) {
      assert.ok(!(await rows(page,'combined')).has(sec),'待复核不得进入联合名单');
    }
    await mark(page,sec,'unf'); await has(second,sec,'unf');
    await page.locator('#clearFilters').click();
    await mark(second,sec,'keep'); await has(page,sec,'keep');
    await mark(second,sec,'unf'); await has(page,sec,'unf');
    // Same displayed value, different revision. The older tab must not undo the newer choice.
    await undo(page); await has(page,sec,'unf');
    if(alt) await mark(second,alt,'keep');
    await page.locator('#markFilter').selectOption('unf');
    const filtered=await rows(page,'visible'), combined=await rows(page,'combined');
    assert.ok(filtered.size===1 && filtered.get(sec)==='取关');
    assert.ok(combined.get(sec)==='取关' && (!alt || combined.get(alt)==='保留'));
    assert.ok([...combined.keys()].every(id=>eligible.has(id)),'冻结账号不能混入合并名单');
    const [exported]=await Promise.all([page.waitForEvent('download'),page.locator('#btnDown').click()]);
    const temp=await fs.mkdtemp(path.join(galleryDir,'.gallery-list-'));
    try {
      const list=path.join(temp,'decisions.txt'); await exported.saveAs(list);
      const {loadUnfollowList}=await import('./unfollow_list.mjs');
      const preview=loadUnfollowList(list);
      assert.ok(preview.duplicate===0 && preview.items.length===1 && preview.items[0].sec_uid===sec,'账号操作预览应仅列出明确的取关决定');
    } finally {
      await fs.rm(path.join(temp,'decisions.txt'),{force:true});
      await fs.rmdir(temp);
    }
    const elsewhere=await rows(second,'combined');
    assert.ok(JSON.stringify([...combined])===JSON.stringify([...elsewhere]));
    if(alt) await undo(second);
    await undo(second); await has(page,sec,'keep');
    await undo(second); await has(page,sec,'unf');
    const later=await context.newPage(); await later.goto(gallery('review'));
    await later.locator('#markFilter').selectOption('all');
    await mark(later,sec,'none'); await has(page,sec,'');
    await later.reload(); await has(later,sec,'');
    const resetRows=await rows(later,'all');
    assert.equal(resetRows.get(sec),'未审','取消历史决定后，旧标记不能重新浮现');
    await undo(later); await has(second,sec,'unf');
    console.log('跨画廊归类与保护、跨页撤销、两页相反决定、旧标记冲突及三种导出范围通过');
  } finally {await context.close();}
}
