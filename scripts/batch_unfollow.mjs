/** Import a decision file. Without --execute this command only reads the live status. */
import fs from 'node:fs';
import path from 'node:path';
import { launch, sleep } from './lib.mjs';
import { reportCsvText, writeJson } from './core.mjs';
import { loadUnfollowList } from './unfollow_list.mjs';
import { processUnfollow, verifyMain, readRegistry } from './unfollow-action.mjs';

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index >= 0) {
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(name + ' 缺少参数值');
    return args[index + 1];
  }
  return args.find((arg) => arg.startsWith(name + '='))?.slice(name.length + 1) ?? fallback;
}
function numberOption(name, fallback) {
  const raw = option(name, null);
  if (raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(name + ' 必须为正整数');
  return n;
}
const LIST = option('--list', '');
const EXECUTE = args.includes('--execute');
const LIMIT = numberOption('--limit', 0);

const STATE = option('--state', 'data/unfollow_state.json');
const REPORT = option('--report', EXECUTE ? 'data/unfollow_report.csv' : 'data/unfollow_dry_report.csv');

if (!LIST) { console.error('用法: node scripts/batch_unfollow.mjs --list <清单csv> [--execute] [--limit N]'); process.exit(1); }

const list = loadUnfollowList(LIST, LIMIT);
const items = list.items;
console.log('清单总行数 ' + list.total + ' | 重复 ' + list.duplicate + ' | 标记保留跳过 ' + list.excluded + ' 条 | 待处理 ' + items.length + ' 条');
if (args.includes('--preview')) {
  for (const item of items) console.log(item.nickname + '　' + item.douyin_id);
  process.exit(0);
}
if (!items.length) { console.log('当前名单没有可处理账号'); process.exit(0); }
if (EXECUTE && items.some((item) => !item.nickname || !item.douyin_id)) throw new Error('执行名单中有空的昵称或抖音号');

function toReportCsv(rows) {
  const cols = ['昵称', '抖音号', 'sec_uid', '结果', '说明'];
  return reportCsvText(cols, rows.map((r) => [r.nickname, r.douyin_id, r.sec_uid, r.result, r.detail]));
}

const state = EXECUTE && fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { done: {}, skipped: {}, failed: {} };
if (EXECUTE) readRegistry();
const report = [];
fs.mkdirSync(path.dirname(REPORT), { recursive: true });
const m = await launch('main', { background: true });
try {
  await verifyMain(m.page);
  for (const item of items) {
    const { code, detail } = await processUnfollow(m.page, item, { execute: EXECUTE });
    report.push({ ...item, result: code === 'done' ? '取关成功' : code === 'absent' ? '本就未关注' : detail, detail });
    fs.writeFileSync(REPORT, toReportCsv(report), 'utf8');
    if (EXECUTE) {
      for (const key of ['done', 'skipped', 'failed']) delete state[key][item.sec_uid];
      const key = code === 'done' ? 'done' : code === 'absent' ? 'skipped' : 'failed';
      state[key][item.sec_uid] = code === 'done' ? new Date().toISOString() : detail;
      writeJson(STATE, state);
      await sleep(1500);
    }
    console.log(report.length + '/' + items.length + ' ' + detail);
    if (code === 'failed') process.exitCode = 1;
  }
} finally {
  await m.context.close().catch(() => {});
}
