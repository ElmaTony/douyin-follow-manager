#!/usr/bin/env node
/**
 * run.mjs — 项目统一入口（用当前 node 运行, 不依赖硬编码路径）
 *
 *   node run.mjs check [--browser]        项目自检(只读)
 *   node run.mjs gallery [review|suspect|stale|all]   重新生成画廊
 *   node run.mjs open                     打开审阅环境(画廊+抖音, 最大化窗口)
 *   node run.mjs transfer                 增量转移: 前置核对 → 合并 → 自适应驱动
 *   node run.mjs unfollow <csv> [--execute]   批量取关(默认干跑, --execute 才动手)
 *   node run.mjs registry                 刷新已取关登记表(顺带检查重新关注)
 *   node run.mjs reset-held [--include-protected]  重置台账中的可重试异常或挂起项
 */
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isLedgerDone, isLedgerHeld, readJson, writeJson } from './core.mjs';

const S = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(S, '..');
import { initialize } from './local-state.mjs';
initialize();

const run = (script, args = []) => {
  console.log(`\n▶ ${script} ${args.join(' ')}`);
  const r = spawnSync(process.execPath, [path.join(S, script), ...args], { stdio: 'inherit', cwd: ROOT, windowsHide:true });
  if (r.status !== 0) {
    console.error(`\n✗ ${script} 失败(退出码 ${r.status})`);
    process.exit(r.status || 1);
  }
};

const [cmd, ...rest] = process.argv.slice(2);
if (cmd !== 'refresh' && cmd !== 'help' && cmd !== '--help' && fs.existsSync(path.join(ROOT,'data','.review-ready'))) {
  console.error('上次在线更新的发布尚未完成，请先运行在线更新以完成发布。');
  process.exit(1);
}
switch (cmd) {
  case 'diff':
    run('compare_snapshots.mjs');
    break;
  case 'refresh':
    run('refresh_review.mjs');
    break;
  case 'check':
    run('doctor.mjs', rest);
    break;
  case 'gallery': {
    const which = rest[0] || 'all';
    const map = { review: 'gen_review_gallery.mjs', suspect: 'gen_suspect_gallery.mjs', stale: 'gen_stale_gallery.mjs' };
    if (which === 'all') { run('build_suspects_latest.mjs'); for (const s of Object.values(map)) run(s); }
    else if (map[which]) {
      const snapFile = path.join(ROOT, 'data', 'snapshot_latest.json');
      const suspectsFile = path.join(ROOT, 'data', 'suspects_latest.json');
      if (fs.existsSync(snapFile) && (!fs.existsSync(suspectsFile) || fs.statSync(suspectsFile).mtimeMs < fs.statSync(snapFile).mtimeMs)) {
        run('build_suspects_latest.mjs');
      }
      run(map[which]);
    }
    else { console.error('用法: node run.mjs gallery review|suspect|stale|all'); process.exit(1); }
    break;
  }
  case 'open':
    run('open_review_env.mjs', rest);
    break;
  case 'transfer': {
    const file = `data/.alt_following_${randomUUID()}.json`;
    try {
      run('preflight_incremental.mjs', [file]);
      run('merge_incremental.mjs', [file]);
    } finally {
      fs.rmSync(path.join(ROOT, file), { force: true });
    }
    run('driver2.mjs');
    run('final_verify.mjs', ['--incremental']);
    run('finalize.mjs');
    break;
  }
  case 'preview':
  case 'unfollow': {
    if (!rest[0]) { console.error('用法: node run.mjs unfollow <清单csv> [--execute]'); process.exit(1); }
    run('batch_unfollow.mjs', ['--list', rest[0], ...rest.slice(1), ...(cmd === 'preview' ? ['--preview'] : [])]);
    break;
  }
  case 'rebuild':
    run('rebuild_latest.mjs');
    break;
  case 'registry':
    run('update_registry.mjs');
    break;
  case 'reset-held': {
    const ledgerFile = path.join(ROOT, 'data', 'ledger.json');
    const rows = readJson(ledgerFile);
    if (!Array.isArray(rows)) {
      console.error('台账缺失或格式错误，无法重置。');
      process.exit(1);
    }
    const includeProtected = rest.includes('--include-protected');
    const mainHeld = new Set(['skip_unknown', 'id_check_fail', 'follow_fail', 'risk_paused', ...(includeProtected ? ['skip_protected'] : [])]);
    const altHeld = new Set(['skip_id_fail', 'unfollow_fail', 'risk_paused']);
    let count = 0;
    for (const r of rows) {
      if (isLedgerDone(r)) continue;
      let changed = false;
      if (mainHeld.has(r.main_follow)) {
        r.main_follow = '';
        r.fail_count = 0;
        changed = true;
      }
      if (altHeld.has(r.alt_unfollow)) {
        r.alt_unfollow = '';
        r.alt_fail_count = 0;
        changed = true;
      }
      if (!isLedgerHeld(r)) {
        if ((r.fail_count || 0) > 0) { r.fail_count = 0; changed = true; }
        if ((r.alt_fail_count || 0) > 0) { r.alt_fail_count = 0; changed = true; }
      }
      if (changed) count++;
    }
    if (count > 0) writeJson(ledgerFile, rows, 2);
    console.log(`已重置 ${count} 条异常或挂起记录为待处理。`);
    break;
  }
  case undefined:
  case 'help':
  case '--help':
  default:
    console.log(`抖音关注管理 — 统一入口

用法: node run.mjs <命令>

  check [--browser]        项目自检(只读; --browser 会额外做一次浏览器干跑)
  gallery [review|suspect|stale|all]   重新生成审阅画廊
  open [review|stale|suspect] 打开审阅环境或指定画廊
  transfer                 增量转移: 前置核对 → 合并 → 自适应驱动 → 终验
  reset-held [--include-protected] 重置台账中的异常或挂起项为待处理
  diff                     比对最近两次快照并导出变化清单
  refresh                  在线更新快照、核验和三个画廊
  rebuild                  基于现有快照重建核验与三个画廊
  preview <名单>             本地预览 CSV / 画廊决定名单
  unfollow <名单> [--execute] 批量取关(默认在线核对)
  registry                 刷新已取关登记表 + 检查重新关注

当前 node: ${process.version}
项目根: ${ROOT}`);
    if (cmd && !['help', '--help'].includes(cmd)) process.exit(1);
}
