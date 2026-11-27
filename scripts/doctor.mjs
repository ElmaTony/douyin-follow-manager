/**
 * doctor.mjs — 项目自检（只读, 不改任何数据）
 *  用法: node run.mjs check [--browser]
 *  检查: 环境 / 核心数据完整性 / 画廊产物与功能标记 / 脚本集合 / 交叉对账
 *  退出码: 0 全通过(可含 WARN), 1 有 FAIL
 */
import fs from 'node:fs';
import path from 'node:path';
import { binding, initialize } from './local-state.mjs';
initialize();
import { CHROME, PROJ, DATA } from './lib.mjs';

import { galleryPayload, isLedgerHeld, isLedgerPending, parseCsv, snapshotTime, staleAtSnapshot, writeTextAtomic } from './core.mjs';

const results = [];
const add = (level, name, detail) => results.push({ level, name, detail });
const j = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

// ---------- 1. 环境 ----------
add(fs.existsSync(CHROME) ? 'PASS' : 'FAIL', 'Chrome 可执行', CHROME);
const nodeMajor = Number(process.versions.node.split('.')[0]);
add(nodeMajor >= 20 ? 'PASS' : 'FAIL', 'Node 运行时', `${process.version} (要求 >=20)`);
for (const a of ['main', 'alt']) {
  const p = path.join(PROJ, 'profiles', a);
  add(binding(a) && fs.existsSync(p) ? 'PASS' : 'WARN', a + ' 账号绑定', binding(a) ? '已绑定' : '请先运行账号设置');
}

// ---------- 2. 核心数据 ----------
const ledger = j(path.join(DATA, 'ledger.json'));
if (Array.isArray(ledger)) {
  const idxs = ledger.map((r) => r.idx);
  const dup = idxs.length - new Set(idxs).size;
  const dupSec = ledger.length - new Set(ledger.map((r) => r.sec_uid)).size;
  const badRows = ledger.filter((r) => !r.sec_uid || !r.idx).length;
  add(dup === 0 && dupSec === 0 && badRows === 0 ? 'PASS' : 'FAIL', '台账 ledger.json',
    `${ledger.length} 条, 重复idx ${dup}, 重复账号 ${dupSec}, 缺字段 ${badRows}, 最大idx ${Math.max(0, ...idxs)}`);
  const pending = ledger.filter(isLedgerPending);
  const held = ledger.filter(isLedgerHeld);
  const heldNote = held.length ? ` (另有 ${held.length} 条受限/挂起)` : '';
  add(pending.length === 0 ? 'PASS' : 'WARN', '台账待处理', `${pending.length} 条未完成${heldNote}`);
} else add('FAIL', '台账 ledger.json', '缺失或解析失败');

const reg = j(path.join(DATA, 'unfollow_registry.json'));
if (reg?.entries) {
  const n = Object.keys(reg.entries).length;
  const alerts = Array.isArray(reg.refollow_alerts) ? reg.refollow_alerts.length : 0;
  add(alerts > 0 ? 'WARN' : 'PASS', '已取关登记表', alerts > 0 ? `${n} 人 (疑似重新关注 ${alerts} 人)` : `${n} 人`);
} else add('FAIL', '已取关登记表', 'unfollow_registry.json 缺失');

const keep = j(path.join(DATA, 'user_keep_list.json'));
add(keep?.keeps ? 'PASS' : 'WARN', '保留名单', keep?.keeps ? `${keep.keeps.length} 人` : '缺失');

const snapLatest = j(path.join(DATA, 'snapshot_latest.json'));
if (snapLatest?.exported_at) {
  const hours = (Date.now() - new Date(snapLatest.exported_at).getTime()) / 3600000;
  add(hours < 72 ? 'PASS' : 'WARN', '最新快照', `${Object.keys(snapLatest.accounts || {}).length} 人, ${hours.toFixed(1)} 小时前`);
} else add('WARN', '最新快照', 'snapshot_latest.json 缺失');
const susLatest = j(path.join(DATA, 'suspects_latest.json'));
add(Array.isArray(susLatest) ? 'PASS' : 'WARN', '嫌疑库(新)', susLatest ? `${susLatest.length} 条` : '缺失');
const banLatest = j(path.join(DATA, 'ban_latest.json')) || [];
add(Array.isArray(banLatest) ? 'PASS' : 'FAIL', '处罚核验(新)', `${banLatest.length} 人, 处罚 ${banLatest.filter((b) => b.status === 'banned').length}`);
const verifiedAccounts = new Map(banLatest.map((b) => [b.sec_uid, b]));
const bannedLatest = new Set(banLatest.filter((b) => b.status === 'banned').map((b) => b.sec_uid));
const accs = Object.entries(snapLatest?.accounts || {});

// ---------- 3. 画廊产物 ----------
const asOf = Number.isFinite(Date.parse(snapLatest?.exported_at)) ? snapshotTime(snapLatest) : null;
const freshWorks = new Map(banLatest.map((b) => [b.sec_uid, b.works_fresh]));
const expReview = accs.filter(([sec, a]) => {
  const f = freshWorks.get(sec);
  const w = typeof f === 'number' ? f : a.works; // 与生成器同口径: 优先 profile 核验值
  return (w || 0) < 20;
}).length;
const expSuspect = (susLatest || []).filter((x) => !bannedLatest.has(x.sec_uid)).length;
const previousAccounts = j(path.join(DATA, 'snapshot_previous.json'))?.accounts || {};
const expStale = asOf === null ? null : accs.filter(([sec, account]) =>
  !bannedLatest.has(sec) && staleAtSnapshot(account, asOf, verifiedAccounts.get(sec), previousAccounts[sec])
).length;
const gallerySpec = [
  { file: 'review_gallery.html', key: 'review_state_v2', expect: expReview, src: 'snapshot <20' },
  { file: 'suspect_gallery.html', key: 'suspect_state_v1', expect: expSuspect, src: 'suspects_latest' },
  { file: 'stale_gallery.html', key: 'stale_state_v1', expect: expStale, src: 'snapshot stale>30' },
];
for (const g of gallerySpec) {
  const p = path.join(DATA, g.file);
  if (!fs.existsSync(p)) { add(snapLatest ? 'FAIL' : 'WARN', `画廊 ${g.file}`, '文件缺失'); continue; }
  const h = fs.readFileSync(p, 'utf8');
  let count = null;
  try { count = galleryPayload(h).data.length; } catch {}
  const feats = ['btnCopy', 'btnDown', 'btnRow', 'btnRowReset', 'id="search"', `"${g.key}"`, 'data-f='];
  const miss = feats.filter((f) => !h.includes(f));
  const okCount = count !== null && count === g.expect;
  add(okCount && !miss.length ? 'PASS' : (okCount ? 'WARN' : 'FAIL'), `画廊 ${g.file}`,
    `${count} 张卡 (期望 ${g.expect})${miss.length ? ' | 缺功能: ' + miss.join(',') : ''} | ${(h.length / 1024).toFixed(0)}KB`);
}

// ---------- 4. 交付表格 ----------
for (const f of ['crosscheck.csv', 'ledger.csv', 'unfollow_report.csv']) {
  const p = path.join(DATA, f);
  if (!fs.existsSync(p)) { add('WARN', `表格 ${f}`, '缺失(需重新 finalize)'); continue; }
  const lines = parseCsv(fs.readFileSync(p, 'utf8')).length;
  add(lines > 1 ? 'PASS' : 'WARN', `表格 ${f}`, `${lines - 1} 行`);
}

// ---------- 5. 脚本集合 ----------
const must = ['lib.mjs', 'core.mjs', 'douyin-api.mjs', 'gallery.mjs', 'run.mjs', 'doctor.mjs', 'transfer.mjs', 'driver2.mjs',
  'batch_unfollow.mjs', 'unfollow_list.mjs', 'preflight_incremental.mjs', 'merge_incremental.mjs', 'final_verify.mjs', 'finalize.mjs',
  'update_registry.mjs', 'setup.mjs', 'gen_review_gallery.mjs', 'gen_suspect_gallery.mjs', 'gen_stale_gallery.mjs',
  'snapshot_main.mjs', 'scan_bans_latest.mjs', 'build_suspects_latest.mjs', 'compare_snapshots.mjs', 'recent-works.mjs', 'topic-change.mjs',
  'refresh_review.mjs', 'rebuild_latest.mjs', 'prep_suspect_unfollow.mjs', 'read_suspect_state.mjs', 'sync_marks.mjs',
  'local-state.mjs', 'open_review_env.mjs', 'profile-tab.mjs', 'gallery-unfollow.mjs', 'gallery-queue.js',
  'unfollow-action.mjs', 'gallery.css', 'gallery-client.js', 'gallery-profiles.js', 'gallery-decisions.js', 'gallery-lightbox.js', 'account-checks.mjs'];
const missScripts = must.filter((f) => !fs.existsSync(path.join(PROJ, 'scripts', f)));
add(missScripts.length ? 'FAIL' : 'PASS', '核心脚本齐全', missScripts.length ? '缺: ' + missScripts.join(',') : `${must.length} 个`);

// ---------- 6. 可选: 浏览器连通(dry-run) ----------
if (process.argv.includes('--browser')) {
  let browser;
  try {
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const tab = await browser.newPage();
    await tab.setContent('<title>关序</title>');
    add((await tab.title()) === '关序' ? 'PASS' : 'FAIL', '浏览器启动', '本地页面');
  } catch (error) { add('FAIL', '浏览器启动', error.message.split('\n')[0]); }
  finally { if (browser) await browser.close(); }
}

// ---------- 输出 ----------
const icon = { PASS: '✅', WARN: '⚠️', FAIL: '❌' };
console.log('\n=== 项目自检报告 ===');
for (const r of results) console.log(`${icon[r.level]} [${r.level}] ${r.name} — ${r.detail}`);
const nF = results.filter((r) => r.level === 'FAIL').length;
const nW = results.filter((r) => r.level === 'WARN').length;
console.log(`\n汇总: ${results.length - nF - nW} 通过 / ${nW} 警告 / ${nF} 失败`);
const report = results.map((r) => `${r.level}\t${r.name}\t${r.detail}`).join('\n');
writeTextAtomic(path.join(DATA, 'doctor_report.txt'), report);
process.exit(nF ? 1 : 0);
