/** 分批执行当前台账中的迁移任务。遇到未确认结果后由用户复核。 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { isLedgerDone, isLedgerHeld, isLedgerPending, localTimeStr } from './core.mjs';

const NODE = process.execPath;
const BATCH = 8;
const LOG = 'data/driver2.log';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(msg) {
  const line = `[${localTimeStr()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n', 'utf8'); } catch {}
}

function readLedger() {
  return JSON.parse(fs.readFileSync('data/ledger.json', 'utf8'));
}

function pending(rows) {
  return rows
    .filter(isLedgerPending)
    .sort((a, b) => {
      const prio = (r) => (r.main_follow === 'done' || r.main_follow === 'already' ? 0 : 1);
      return prio(a) - prio(b) || a.idx - b.idx;
    });
}

let rounds = 0;
const attempted = new Set();
while (rounds < 40) {
  const todo = pending(readLedger()).filter((r) => !attempted.has(r.idx));
  if (!todo.length) { log('=== 全部队列遍历完毕 ==='); break; }
  rounds++;
  const batch = todo.slice(0, BATCH);
  const ids = batch.map((r) => r.idx);
  for (const id of ids) attempted.add(id);
  log(`--- 第 ${rounds} 轮: 处理 ${ids.length} 个 [${ids.join(',')}] ---`);

  const res = spawnSync(NODE, ['scripts/transfer.mjs', String(ids.length), `--ids=${ids.join(',')}`], {
    stdio: 'inherit', encoding: 'utf8', windowsHide: true,
  });
  if (res.status === 2) { log('!! 登录态失效, driver2 停止, 需重新扫码'); process.exit(2); }
  if (res.status !== 0 || res.error) {
    log('子任务异常中止，保留当前进度');
    process.exit(res.status || 1);
  }

  const rows = readLedger();
  const doneRows = rows.filter((r) => ids.includes(r.idx));
  const riskPaused = doneRows.some((r) => r.main_follow === 'risk_paused' || r.alt_unfollow === 'risk_paused');
  const ok = doneRows.filter(isLedgerDone).length;
  const held = doneRows.filter(isLedgerHeld).length;
  const unresolved = doneRows.length - ok - held;
  const warnPrefix = held > 0 || unresolved > 0 ? '[WARN] ' : '';
  log(`${warnPrefix}第 ${rounds} 轮结果: 成功 ${ok}, 受限/挂起 ${held}, 待重试/未完成 ${unresolved}`);

  if (riskPaused) {
    log('出现平台风控限制，已保存台账，请人工复核后再开始。');
    process.exit(1);
  }
  const remaining = pending(rows).filter((r) => !attempted.has(r.idx));
  if (!remaining.length) break;
  log('本轮无风控阻断，歇 3 分钟继续下一批');
  await sleep(3 * 60 * 1000);
}
const allPending = pending(readLedger());
const unattempted = allPending.filter((r) => !attempted.has(r.idx));
if (unattempted.length) { log('达到本次处理上限，仍有待处理记录'); process.exit(1); }
if (allPending.length) {
  log(`[WARN] 队列已遍历完毕，尚有 ${allPending.length} 条异常记录待下次重试或复核。`);
}
log(`=== driver2 结束, 共 ${rounds} 轮 ===`);
