/** 无登录浏览器复测。--offline 禁止联网，截图存于临时目录。 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { CHROME, DATA } from './lib.mjs';

const args = process.argv.slice(2);
const offline = args.includes('--offline');
const target = path.resolve(args.find(arg => !arg.startsWith('--')) || path.join(DATA, 'suspect_gallery.html'));
const output = offline ? await fs.mkdtemp(path.join(os.tmpdir(), 'gallery-qa-')) : DATA;
const url = file => pathToFileURL(file).href;
const browser = await chromium.launch({ executablePath: CHROME, headless: !args.includes('--headed') });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  if (offline) await context.route(/^https?:/, route => route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const click = selector => page.locator(selector).first().click();
  const fits = async () => assert.ok(await page.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth), '页面超出视口');
  const files = new Set(['review_gallery.html', 'stale_gallery.html', 'suspect_gallery.html'].map(f => path.join(DATA, f)));
  for (const file of files) {
    await page.goto(url(file), { waitUntil: 'domcontentloaded' });
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
      const manualBefore=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'{}'),cfg.key);
      await click('#lbKeep');
      const manualAfter=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'{}'),cfg.key);
      assert.deepEqual(manualAfter,{...manualBefore,[reviewer.sec_uid]:'keep'},'一次决定只保存一个账号');
      assert.equal(await page.evaluate(({key,id})=>JSON.parse(localStorage.getItem(key))[id],{key:cfg.key,id:reviewer.sec_uid}),'keep');
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
    const marked=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'{}'),cfg.key);
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
    await row.locator('.b-unf').click();
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
      const marks = await page.evaluate(k=>JSON.parse(localStorage.getItem(k)||'{}'),cfg.key);
      assert.deepEqual(await ids(),cfg.data.filter(d=>d.group==='s180' && unlocked(d) && !marks[d.sec_uid]).sort((a,b)=>b.gap-a.gap).map(d=>d.sec_uid));
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
    await click('#btnRow'); assert.equal(await page.evaluate(() => window.qaLinks.length), Math.min(cfg.data.length,5));
    await page.locator('#search').fill(first.sec_uid);
    assert.equal(await cards.count(),1);
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
    assert.equal(download.suggestedFilename(), 'decisions.txt');
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
  await page.screenshot({path:path.join(output, 'qa_gallery.png')});
  await page.emulateMedia({colorScheme:'dark'});
  await page.setViewportSize({width:390,height:844});
  await fits();
  if (offline) await page.screenshot({path:path.join(output, 'mobile-dark.png')});
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
  await page.screenshot({path:path.join(output, 'qa_lightbox.png')});
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
  console.log('灯箱 / 键盘 / 深色布局通过；截图目录', output);
} finally {
  await browser.close();
}
