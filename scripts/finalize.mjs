/** 根据最终复核结果输出台账与逐条对照表。 */
import { loadLedger, toCsv } from './lib.mjs';
import { isFollowingStatus, reportCsvText } from './core.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(path.resolve(__dirname, '..'), 'data');

const rows = loadLedger();

// 刷新本地表格 ledger.csv (原 12 列 schema)
toCsv(rows, path.join(dataDir, 'ledger.csv'));

// 读取 verify 实际状态
const vj = JSON.parse(fs.readFileSync(path.join(dataDir, 'verify.json'), 'utf8'));
const vmap = new Map(vj.rows.map((r) => [r.idx, r]));

// 逐条核对表
const cols = ['idx', 'nickname', 'douyin_id', '台账大号', '台账小号', '实际大号', '实际小号', '结论'];
const csvRows = [];
const reasonMap = {
  skip_restricted: '博主被禁言/关注被拒/注销',
  skip_protected: '命中取关登记或保留名单',
  skip_unknown: '重试失败(无限制提示)',
  follow_fail: '关注复查未变(临时失败)',
  id_check_fail: '身份核对失败',
  risk_paused: '风控暂停',
};
let transferred = 0, kept = 0, mismatch = 0;
const keptBreakdown = {};
for (const r of rows) {
  const v = vmap.get(r.idx);
  const mStat = v ? v.main_status : '?';
  const aStat = v ? v.alt_status : '?';
  let concl;
  if (isFollowingStatus(mStat) && aStat === 0) {
    concl = '✓ 已转移(大号关注/小号取关)';
    transferred++;
  } else if (mStat === 0 && isFollowingStatus(aStat)) {
    const why = reasonMap[r.main_follow] || r.main_follow || '未处理';
    concl = `保留小号(大号未关注: ${why})`;
    kept++;
    keptBreakdown[r.main_follow] = (keptBreakdown[r.main_follow] || 0) + 1;
  } else if (isFollowingStatus(mStat) && isFollowingStatus(aStat)) {
    concl = '⚠ 异常: 大号已关注但小号未取关';
    mismatch++;
  } else {
    concl = `⚠ 异常: 双方均未关注 (台账大号=${r.main_follow})`;
    mismatch++;
  }
  csvRows.push([r.idx, r.nickname, r.douyin_id, r.main_follow || '', r.alt_unfollow || '', mStat, aStat, concl]);
}
fs.writeFileSync(path.join(dataDir, 'crosscheck.csv'), reportCsvText(cols, csvRows), 'utf8');

console.log('\n===== 终态统计 =====');
console.log(`总记录: ${rows.length}`);
console.log(`✓ 已转移(大号关注+小号取关): ${transferred}`);
console.log(`⏸ 保留在小号(大号未关注): ${kept}  => ` + JSON.stringify(keptBreakdown));
console.log(`⚠ 异常不一致: ${mismatch}`);
console.log(`大号实际 following_count(本次核实): ${vj.selfM.following_count}`);
console.log(`生成文件: ledger.csv(本地表格), crosscheck.csv(逐条核对), verify.json`);
