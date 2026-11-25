/**
 * rebuild_latest — 一键重建三套画廊(基于 snapshot_latest.json)
 *  嫌疑分析 → 处罚核验(浏览器) → 三画廊 → 自检
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const step = (s) => {
  console.log(`\n▶ ${s}`);
  const r = spawnSync(process.execPath, [path.join(HERE, s)], { stdio: 'inherit', cwd: ROOT, windowsHide: true });
  if (r.status !== 0) { console.error(`✗ ${s} 失败`); process.exit(r.status || 1); }
};
step('build_suspects_latest.mjs');
step('scan_bans_latest.mjs');
step('gen_review_gallery.mjs');
step('gen_suspect_gallery.mjs');
step('gen_stale_gallery.mjs');
step('doctor.mjs');
