/** 分批执行当前台账中的迁移任务。遇到未确认结果后由用户复核。 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const NODE = process.execPath;
const BATCH = 8;
const LOG = 'data/driver2.log';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(msg) {
  const line = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n', 'utf8'); } catch {}
}

function readLedger() {
  return JSON.parse(fs.readFileSync('data/ledger.json', 'utf8'));
}

function pending(rows) {
  return rows
    .filter((r) => r.alt_unfollow !== 'done' && r.main_follow !== 'skip_restricted' && r.alt_unfollow !== 'skip_not_following')
    .sort((a, b) => {
      const prio = (r) => (r.main_follow === 'done' || r.main_follow === 'already' ? 0 : 1);
      return prio(a) - prio(b) || a.idx - b.idx;
    });
}

let rounds = 0;
while (rounds < 40) {
  const todo = pending(readLedger());
  if (!todo.length) { log('=== 全部处理完毕 ==='); break; }
  rounds++;
  const batch = todo.slice(0, BATCH);
  const ids = batch.map((r) => r.idx);
  log(`--- 第 ${rounds} 轮: 处理 ${ids.length} 个 [${ids.join(',')}] ---`);

  const res = spawnSync(NODE, ['scripts/transfer.mjs', String(ids.length), `--ids=${ids.join(',')}`], {
    stdio: 'inherit', encoding: 'utf8', windowsHide:true,
  });
  if (res.status === 2) { log('!! 登录态失效, driver2 停止, 需重新扫码'); process.exit(2); }
  if (res.status !== 0 || res.error) {
    log('子任务异常中止，保留当前进度');
    process.exit(res.status || 1);
  }

  const rows = readLedger();
  const doneRows = rows.filter((r) => ids.includes(r.idx));
  const ok = doneRows.filter((r) => (r.main_follow === 'done' || r.main_follow === 'already') && r.alt_unfollow === 'done').length;
  const restricted = doneRows.filter((r) => r.main_follow === 'skip_restricted').length;
  const failed = doneRows.filter((r) =>
    ['follow_fail', 'skip_unknown', 'risk_paused', 'id_check_fail'].includes(r.main_follow) ||
    ['unfollow_fail', 'risk_paused', 'skip_id_fail'].includes(r.alt_unfollow)
  ).length;
  log(`第 ${rounds} 轮结果: 成功 ${ok}, 受限 ${restricted}, 失败/风控 ${failed}`);

  if (!pending(rows).length) break;
  if (failed > 0) {
    log('出现失败或平台限制，已保存台账，请人工复核后再开始。');
    process.exit(1);
  } else {
    log('本轮全部顺利, 歇 3 分钟继续');
    await sleep(3 * 60 * 1000);
  }
}
if (pending(readLedger()).length) { log('达到本次处理上限，仍有待处理记录'); process.exit(1); }
log(`=== driver2 结束, 共 ${rounds} 轮 ===`);
