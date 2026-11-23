/** 使用固定浏览器档案打开审阅画廊，沿用原有标记。 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATA, launch } from './lib.mjs';

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
const { context, page } = await launch('main');
const closed = new Promise(resolve => context.once('close', resolve));
try {
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
