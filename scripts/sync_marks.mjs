/**
 * sync_marks — 把卖号嫌疑画廊的决定同步到低作品审阅画廊:
 *  交集账号(既是低作品候选, 又是卖号嫌疑): 嫌疑画廊里已点的 保留/取关 直接继承,
 *  低作品画廊里已有决定的以用户手动为准(不覆盖)
 *  只写 localStorage, 不执行任何取关/关注动作
 */
import { launch, DATA } from './lib.mjs';
import { galleryPayload, reviewableRows } from './core.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sourceFile = path.join(DATA, 'suspect_gallery.html');
const destFile = path.join(DATA, 'review_gallery.html');
const source = galleryPayload(fs.readFileSync(sourceFile, 'utf8'));
const dest = galleryPayload(fs.readFileSync(destFile, 'utf8'));
const eligible = new Set(reviewableRows(dest).map(row => row.sec_uid));
const shared = reviewableRows(source).map(row => row.sec_uid).filter(sec => eligible.has(sec));
const m = await launch('main');
let res;
try {
  await m.page.goto(pathToFileURL(sourceFile).href, {waitUntil:'domcontentloaded'});
  const marks = await m.page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), source.key);
  await m.page.goto(pathToFileURL(destFile).href, {waitUntil:'domcontentloaded'});
  res = await m.page.evaluate(({key, shared, marks}) => {
    const candidates = new Set(shared);
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    const stats = {syncKeep:0, syncUnf:0, alreadyRev:0, notCandidate:0};
    for (const [sec, mark] of Object.entries(marks)) {
      if (mark !== 'keep' && mark !== 'unf') continue;
      if (!candidates.has(sec)) { stats.notCandidate++; continue; }
      if (saved[sec]) { stats.alreadyRev++; continue; }
      saved[sec] = mark;
      if (mark === 'keep') stats.syncKeep++; else stats.syncUnf++;
    }
    localStorage.setItem(key, JSON.stringify(saved));
    return stats;
  }, {key:dest.key, shared, marks});
} finally {
  await m.context.close();
}
console.log('===== 同步完成 =====');
console.log(`继承保留: ${res.syncKeep} | 继承取关: ${res.syncUnf} | 你已在低作品画廊标过(以手动为准): ${res.alreadyRev} | 非低作品候选(跳过): ${res.notCandidate}`);
process.exit(0);
