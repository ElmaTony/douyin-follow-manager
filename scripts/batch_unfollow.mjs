/**
 * batch_unfollow — 大号批量取关工具（安全版）
 *
 * 用法:
 *   node scripts/batch_unfollow.mjs --list data/low_works_verified.csv            # 干跑(默认): 只读每条真实关注状态, 不点任何按钮
 *   node scripts/batch_unfollow.mjs --list data/low_works_verified.csv --execute  # 真执行
 *   可选: --limit 20        只处理前 N 条(分批试水)
 *         --cooldown 30    命中风控后冷却分钟数(默认 30)
 *         --state data/unfollow_state.json  状态文件(断点续跑)
 *
 * 安全设计:
 *   1) 只处理清单内的 sec_uid, 绝不越界到其他关注
 *   2) 每条先核对身份: 路径 sec_uid + 页面抖音号 与清单一致, 不一致则跳过(防同名错杀)
 *   3) 每条先读 follow_status: 0=已未关注(跳过, 不点击); 1=才执行取关
 *   4) 取关后复查=0 才记 done; 仍=1 记 fail(重试一次)
 *   5) 清单中「保留(填1则跳过)」列填了 1 的整条跳过
 *   6) 状态文件断点续跑, 已完成的不重复操作
 *   7) 命中风控提示 -> 暂停并冷却, 打印恢复时间
 *   8) 结束输出 data/unfollow_report.csv 明细(取关成功/本就没关注/跳过/失败)
 */
import { launch, sleep, randInt } from './lib.mjs';
import { confirmedStatus, isOwner, selfInfo } from './account-checks.mjs';
import { writeJson } from './core.mjs';
import { loadUnfollowList } from './unfollow_list.mjs';
import fs from 'node:fs';

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
const COOLDOWN_MIN = numberOption('--cooldown', 30);
const STATE = option('--state', 'data/unfollow_state.json');
const REPORT = EXECUTE ? 'data/unfollow_report.csv' : 'data/unfollow_dry_report.csv';

if (!LIST) { console.error('用法: node scripts/batch_unfollow.mjs --list <清单csv> [--execute] [--limit N]'); process.exit(1); }

const COMMON = {
  device_platform: 'webapp', aid: '6383', channel: 'channel_pc_web', pc_client_type: '1',
  version_code: '170400', version_name: '17.4.0', cookie_enabled: 'true', platform: 'PC', downlink: '10',
};
const BTN = 'button[data-e2e="user-info-follow-btn"]';
const RISK = ['滑动验证', '安全验证', '滑块', '操作过于频繁', '请求过于频繁', '稍后再试', '请稍后重试', '操作频繁'];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const list = loadUnfollowList(LIST, LIMIT);
const items = list.items;
log('清单总行数 ' + list.total + ' | 重复 ' + list.duplicate + ' | 标记保留跳过 ' + list.excluded + ' 条 | 待处理 ' + items.length + ' 条');
if (args.includes('--preview')) {
  for (const item of items) console.log(item.nickname + '　' + item.douyin_id);
  process.exit(0);
}
if (!items.length) { log('当前名单没有可处理账号'); process.exit(0); }
if (EXECUTE && items.some(item => !item.nickname || !item.douyin_id)) throw new Error('执行名单中有空的昵称或抖音号');

// ---- 状态(断点续跑) ----
let state = { done: {}, skipped: {}, failed: {} };
if (EXECUTE && fs.existsSync(STATE)) state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
const saveState = () => { if (EXECUTE) writeJson(STATE, state); };

// ---- 浏览器 ----
const m = await launch('main');
const me = await selfInfo(m, COMMON);
if (!isOwner(me, 'main')) {
  log('大号身份异常，已终止');
  await m.context.close().catch(() => {}); process.exit(2);
}
log(`大号确认: ${me.nickname} (${me.short_id}), 当前关注 ${me.following_count}`);

async function readStatus(secUid) {
  const response = await m.page.evaluate(async ({ sec, common }) => {
    const qs = new URLSearchParams({ ...common, sec_user_id: sec, source_type: '4', publish_video_strategy_type: '2' });
    const r = await fetch('https://www.douyin.com/aweme/v1/web/user/profile/other/?' + qs, {
      headers: { accept: 'application/json', referer: 'https://www.douyin.com/' }, credentials: 'include',
    });
    const d = await r.json();
    return { sec_uid: d?.user?.sec_uid, restricted: d?.user?.punish_remind_info?.is_punish === true, status_code: d?.status_code, follow_status: d?.user?.follow_status, nickname: d?.user?.nickname, unique_id: d?.user?.unique_id || '', short_id: d?.user?.short_id ? String(d.user.short_id) : '' };
  }, { sec: secUid, common: COMMON });
  confirmedStatus(response, secUid);
  return response;
}
async function clickBtn() {
  return m.page.evaluate((sel) => {
    const btns = [...document.querySelectorAll(sel)].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (!btns.length) return 'no-btn';
    btns[0].click(); return 'clicked';
  }, BTN);
}
async function clickConfirm() {
  return m.page.evaluate(() => {
    const labels = ['确认', '确定', '仍然取消关注', '取消关注', '确认取消关注'];
    const btns = [...document.querySelectorAll('button, [role="button"]')].filter((b) => {
      const tx = (b.textContent || '').trim(); const r = b.getBoundingClientRect();
      return labels.includes(tx) && r.width > 0 && r.height > 0;
    });
    if (btns.length) { btns[btns.length - 1].click(); return (btns[btns.length - 1].textContent || '').trim(); }
    return null;
  });
}
async function riskIn() {
  const txt = await m.page.evaluate(() => document.body?.innerText || '').catch(() => '');
  return RISK.filter((p) => txt.includes(p));
}

// ---- 主循环 ----
const report = [];
let done = 0, skipNoFollow = 0, fail = 0, idFail = 0, riskHit = 0;
for (let k = 0; k < items.length; k++) {
  const t = items[k];
  if (state.done[t.sec_uid] || state.skipped[t.sec_uid]) { log(`[${k + 1}/${items.length}] ${t.nickname} 已完成过, 跳过`); continue; }
  log(`--- [${k + 1}/${items.length}] ${t.nickname} (${t.douyin_id}) ---`);

  await m.page.goto(`https://www.douyin.com/user/${t.sec_uid}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await sleep(randInt(2500, 4000));

  // 身份核对(路径 sec_uid + 页面抖音号)
  const idc = await m.page.evaluate(() => {
    const pathSec = (location.pathname.split('/user/')[1] || '').split('?')[0];
    const m1 = document.body?.innerText?.match(/抖音号[:：]\s*([^\s]+)/);
    return { pathSec, pageId: m1 ? m1[1] : null, title: document.title };
  }).catch(() => ({ pathSec: '', pageId: null, title: '' }));
  const secOk = idc.pathSec === t.sec_uid;
  const idOk = !!idc.pageId && (idc.pageId === t.douyin_id || idc.pageId === (t.douyin_id || '').replace(/^0+/, ''));
  if (!secOk || (t.douyin_id && !idOk) || (EXECUTE && (!idOk || !t.nickname || !idc.title.includes(t.nickname)))) {
    log(`!! 身份核对不通过: 路径=${secOk} 页面抖音号=${idc.pageId} 期望=${t.douyin_id}; 跳过`);
    state.failed[t.sec_uid] = '身份核对失败';
    report.push({ ...t, result: '身份核对失败', detail: `页面抖音号=${idc.pageId}` });
    idFail++; saveState(); continue;
  }

  const st0 = await readStatus(t.sec_uid);
  if (st0.restricted) {
    report.push({ ...t, result: '异常账号保留', detail: '' });
    continue;
  }
  if (st0.follow_status === 0) {
    log(`当前未关注(follow_status=${st0.follow_status}), 无需取关`);
    state.skipped[t.sec_uid] = '本就未关注';
    report.push({ ...t, result: '本就未关注', detail: '' });
    skipNoFollow++; saveState(); continue;
  }

  if (!EXECUTE) {
    report.push({ ...t, result: '待取关(dry-run)', detail: '' });
    log(`[dry-run] 将取关(当前 follow_status=1)`);
    await sleep(randInt(600, 1000));
    continue;
  }

  const c = await clickBtn();
  log(`点击 => ${c}`);
  await sleep(randInt(2200, 3200));
  const cf = await clickConfirm();
  if (cf) log(`确认弹窗 => ${cf}`);
  await sleep(randInt(3000, 4500));

  let ok = false;
  for (let a = 0; a < 2 && !ok; a++) {
    const st = await readStatus(t.sec_uid);
    if (st.follow_status === 0) { ok = true; break; }
    if (a === 0) { log('复查仍为 1, 重试一次点击'); await clickBtn(); await sleep(randInt(2500, 3500)); await clickConfirm(); await sleep(3000); }
  }
  if (ok) {
    log('✓ 取关成功(复查 follow_status=0)');
    state.done[t.sec_uid] = new Date().toISOString();
    report.push({ ...t, result: '取关成功', detail: '' });
    done++;
  } else {
    const risk = await riskIn();
    if (risk.length) {
      log(`!! 风控提示: ${risk.join(',')} —— 暂停, 冷却 ${COOLDOWN_MIN} 分钟`);
      report.push({ ...t, result: '风控暂停', detail: risk.join(',') });
      riskHit++;
      saveState();
      if (report.length) fs.writeFileSync(REPORT, toReportCsv(report), 'utf8');
      await sleep(COOLDOWN_MIN * 60 * 1000);
      k--; continue; // 冷却后重试同一条
    }
    log('✗ 取关失败(复查仍为 1)');
    state.failed[t.sec_uid] = '取关复查未变';
    report.push({ ...t, result: '取关失败', detail: '复查仍为1' });
    fail++;
  }
  saveState();
  if (report.length) fs.writeFileSync(REPORT, toReportCsv(report), 'utf8');
  await sleep(randInt(6000, 12000)); // 账号间隔, 降低风控概率
}

function toReportCsv(rows) {
  const cols = ['昵称', '抖音号', 'sec_uid', '结果', '说明'];
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '\uFEFF' + [cols.join(','), ...rows.map((r) => [r.nickname, r.douyin_id, r.sec_uid, r.result, r.detail].map(esc).join(','))].join('\r\n');
}

if (report.length) fs.writeFileSync(REPORT, toReportCsv(report), 'utf8');
log('===== 结束 =====');
log(`${EXECUTE ? '执行' : '干跑'}统计: 待取关 ${report.filter((r) => r.result.startsWith('待取关')).length} | 取关成功 ${done} | 本就未关注 ${skipNoFollow} | 身份核对失败 ${idFail} | 取关失败 ${fail} | 风控暂停 ${riskHit}`);
log(`明细: ${REPORT} | 状态: ${STATE}`);
await m.context.close().catch(() => {});
process.exit(idFail || fail ? 1 : 0);
