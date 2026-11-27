/** 使用固定浏览器档案打开审阅画廊，沿用原有标记。 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { attachGalleryUnfollow } from './gallery-unfollow.mjs';
import { templateTag } from './gallery.mjs';
import { attachProfileTab } from './profile-tab.mjs';
import { DATA, PROJ, launch } from './lib.mjs';

if (PROJ) process.chdir(path.resolve(PROJ));

const files = new Map([
  ['stale', 'stale_gallery.html'], ['suspect', 'suspect_gallery.html'], ['review', 'review_gallery.html'],
]);
const selected = process.argv[2];
if (selected && !files.has(selected)) throw new Error('未知画廊类型');
const targets = (selected ? [files.get(selected)] : [...files.values()]).map(name => {
  const file = path.join(DATA, name);
  if (!fs.existsSync(file)) throw new Error('画廊文件缺失，请先重新生成画廊');
  return pathToFileURL(file).href;
});
if (!selected) targets.push('https://www.douyin.com/');
// Upgrade generated pages in place so existing bookmarks and review decisions still work.
const needUpgrade = [];
for (const [kind,name] of files) {
  const file=path.join(DATA,name);
  if (!fs.existsSync(file)) continue;
  const prefix=Buffer.alloc(512), fd=fs.openSync(file,'r');
  try { fs.readSync(fd,prefix,0,prefix.length,0); } finally { fs.closeSync(fd); }
  if (!prefix.toString('utf8').includes(templateTag)) needUpgrade.push(kind);
}
if (needUpgrade.length) {
  const snapFile = path.join(DATA, 'snapshot_latest.json');
  const suspectsFile = path.join(DATA, 'suspects_latest.json');
  if (fs.existsSync(snapFile) && (!fs.existsSync(suspectsFile) || fs.statSync(suspectsFile).mtimeMs < fs.statSync(snapFile).mtimeMs)) {
    await import('./build_suspects_latest.mjs');
  }
  for (const kind of needUpgrade) await import('./gen_'+kind+'_gallery.mjs');
}
const { context, page } = await launch('main');
const closed = new Promise(resolve => context.once('close', resolve));
try {
  const galleryPaths=[...files.values()].map(name=>path.join(DATA,name));
  await attachGalleryUnfollow(context,galleryPaths);
  await attachProfileTab(context,galleryPaths);
  for (const [i, target] of targets.entries()) {
    const tab = i ? await context.newPage() : page;
    await tab.goto(target, { waitUntil: 'domcontentloaded' });
  }
  await page.bringToFront();
  console.log('审阅画廊已打开。关闭审阅浏览器窗口后可运行下一项任务。');
  await closed;
} finally {
  await context.close().catch(() => {});
}
