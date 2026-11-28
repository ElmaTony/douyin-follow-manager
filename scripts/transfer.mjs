/**
 * 抖音关注转移主脚本 (UI 点击版, 绕过签名):
 *   对台账里每个待处理的博主:
 *     1) 大号(main)打开主页(sec_uid 直访) -> 身份核对(路径sec_uid + 页面抖音号 + 标题)
 *     2) 读 follow_status(main); 若为0则 UI 关注 -> 复查确认已关注(1/2) -> main_follow=done; 若已关注则 main_follow=already
 *     3) 仅当大号已关注: 小号(alt)打开主页 -> 身份核对 -> 读 follow_status(应为1/2) -> UI 取关 -> 复查=0 -> alt_unfollow=done
 *   全程限速 + 风控暂停 + 断点续跑(基于 ledger 状态)。
 *
 * 用法: node scripts/transfer.mjs [BATCH]   默认每轮处理 5 个
 */
import { launch, log, sleep, randInt, loadLedger, saveLedger } from './lib.mjs';
import fs from 'node:fs';
import { confirmedStatus, isOwner, selfInfo } from './account-checks.mjs';
import { isFollowingStatus, isLedgerPending, normText } from './core.mjs';
import {
  COMMON,
  FOLLOW_ACTION_RE,
  FOLLOW_BTN_SELECTOR,
  FOLLOWING_BTN_RE,
  RISK_PATTERNS,
  fetchProfileOther,
  inspectProfileDom,
  waitProfileHydrated,
} from './douyin-api.mjs';

const args = process.argv.slice(2);
const UNFOLLOW_ONLY = args.includes('--unfollow-only'); // 只处理大号已关注的(小号取关), 不尝试新关注
const BATCH = Math.max(1, parseInt(args.find((a) => /^\d+$/.test(a)) || '5', 10));
log(`模式: ${UNFOLLOW_ONLY ? 'unfollow-only(仅取关, 跳过需新关注的)' : 'normal'} | 每轮 ${BATCH} 个`);
const SKIP_FAIL = args.includes('--skip-follow-fail');
const rows = loadLedger();
// --ids=80,83,92 只处理指定 idx(用于跳过已确认受限的账号)
const IDS = (args.find((a) => a.startsWith('--ids=')) || '').replace('--ids=', '');
let todo;
if (IDS) {
  const idSet = new Set(IDS.split(',').map((s) => s.trim()).filter(Boolean));
  todo = rows.filter((r) => idSet.has(String(r.idx)) && isLedgerPending(r));
} else {
  todo = rows.filter(isLedgerPending);
}
if (SKIP_FAIL) todo = todo.filter((r) => r.main_follow !== 'follow_fail');
log(`本轮目标: ${BATCH} 个 (台账未完成共 ${todo.length} 个)`);

async function riskIn(page) {
  const txt = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  return RISK_PATTERNS.filter((p) => txt.includes(p));
}
async function openProfile(ctx, secUid) {
  await ctx.page.goto(`https://www.douyin.com/user/${secUid}`, { waitUntil: 'domcontentloaded' });
  await waitProfileHydrated(ctx.page, { fallbackMs: randInt(3000, 5000) });
  if (typeof ctx.page?.waitForFunction === 'function') await sleep(randInt(1000, 2200));
}
async function verifyIdentity(page, t) {
  const raw = await inspectProfileDom(page);
  const info = { pathSec: raw.sec, pageId: raw.id, title: raw.title };
  const secOk = info.pathSec === t.sec_uid;
  const idOk = !!info.pageId && (info.pageId === t.douyin_id || info.pageId === t.legacy_short_id);
  const nameOk = Boolean(normText(t.nickname)) && normText(info.title).includes(normText(t.nickname));
  return { secOk, idOk, nameOk, info };
}
async function readStatus(page, secUid) {
  const response = await fetchProfileOther(page, secUid, COMMON);
  confirmedStatus(response, secUid);
  return response;
}
async function confirmRenamedStatus(page, t, idCheck) {
  if (!idCheck.secOk || !idCheck.idOk || idCheck.nameOk) return null;
  const profile = await readStatus(page, t.sec_uid);
  const idMatch =
    (t.douyin_id && (profile.unique_id === t.douyin_id || profile.short_id === t.douyin_id)) ||
    (t.legacy_short_id && profile.short_id === t.legacy_short_id);
  if (profile.sec_uid === t.sec_uid && idMatch && profile.nickname) {
    log(`昵称已更新: ${t.nickname} -> ${profile.nickname}`);
    if (t.nickname && normText(t.nickname) !== normText(profile.nickname)) {
      if (!Array.isArray(t.former_nicknames)) t.former_nicknames = [];
      if (!t.former_nicknames.some((n) => normText(n) === normText(t.nickname))) {
        t.former_nicknames.push(t.nickname);
      }
    }
    t.nickname = profile.nickname;
    idCheck.nameOk = true;
    return profile;
  }
  return null;
}
async function clickFollow(page, mode) {
  const pattern = (mode === 'follow' ? FOLLOW_ACTION_RE : FOLLOWING_BTN_RE).source;
  return page.evaluate(({ sel, pattern }) => {
    const re = new RegExp(pattern);
    const btns = [...document.querySelectorAll(sel)].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (!btns.length) return 'no-btn';
    const tx = (btns[0].textContent || '').trim();
    if (!re.test(tx)) return 'mismatch:' + tx;
    btns[0].click();
    return 'clicked';
  }, { sel: FOLLOW_BTN_SELECTOR, pattern });
}
async function clickConfirm(page) {
  return page.evaluate(() => {
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const dialogLabels = ['确认', '确定', '仍然取消关注', '取消关注', '确认取消关注'];
    const dialogs = [...document.querySelectorAll('[role="dialog"], dialog[open], [class*="modal"], [class*="Dialog"]')]
      .filter((dlg) => isVisible(dlg) && (dlg.textContent || '').includes('取消关注'));
    for (const dlg of dialogs) {
      const btns = [...dlg.querySelectorAll('button, [role="button"]')].filter((b) => {
        const tx = (b.textContent || '').trim();
        return dialogLabels.includes(tx) && isVisible(b);
      });
      if (btns.length) { btns[btns.length - 1].click(); return (btns[btns.length - 1].textContent || '').trim(); }
    }
    const explicitLabels = ['仍然取消关注', '确认取消关注'];
    const explicitBtns = [...document.querySelectorAll('button, [role="button"]')].filter((b) => {
      const tx = (b.textContent || '').trim();
      return explicitLabels.includes(tx) && isVisible(b);
    });
    if (explicitBtns.length) {
      explicitBtns[explicitBtns.length - 1].click();
      return (explicitBtns[explicitBtns.length - 1].textContent || '').trim();
    }
    return null;
  });
}

function clearNoteParts(note, side) {
  const patterns = side === 'main'
    ? [/^main身份核对失败:.*$/, /^main关注复查未变.*$/, /^main风控:.*$/, /^unfollow-only跳过.*$/]
    : [/^alt身份核对失败.*$/, /^alt取关复查未变.*$/, /^alt风控:.*$/];
  return String(note || '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && !patterns.some((re) => re.test(s)))
    .join('; ');
}

// 抓取关注后的异常提示(toast, 约 2-3s 即消失), 用于判定博主自身是否被限制/禁言/注销
// 收紧判定: 真实 toast 都是 <=16 字且以固定前缀开头的短语, 避免把签名长文本(如"这个世界上不存在")误判成限制提示
const TOAST_RE = /无法关注|禁言|已被限制|违规|限制关注|关注失败|账号已?注销|不存在|该用户|内容涉及|对方已?设置|暂时无法|私号|不接收|开启关注验证/;
async function captureToast(page, ms = 3000) {
  const deadline = Date.now() + ms;
  const found = [];
  while (Date.now() < deadline) {
    const t = await page.evaluate((reSrc) => {
      const re = new RegExp(reSrc);
      const pre = /^(该用户|无法|账号|用户|内容|对方|暂时|私号|不接收|开启|关注失败|已被|违规|限制|关注请求)/;
      const out = [];
      document.querySelectorAll('body *').forEach((n) => {
        const tx = (n.textContent || '').trim();
        if (re.test(tx) && tx.length <= 16 && pre.test(tx) && n.children.length <= 1) out.push(tx);
      });
      return [...new Set(out)];
    }, TOAST_RE.source).catch(() => []);
    if (t.length) found.push(...t);
    if (found.length) break;
    await sleep(400);
  }
  return [...new Set(found)];
}

const registry = JSON.parse(fs.readFileSync('data/unfollow_registry.json', 'utf8')).entries;
const keepIds = new Set(JSON.parse(fs.readFileSync('data/user_keep_list.json', 'utf8')).keeps.map((entry) => entry.sec_uid));

let m, a;
try {
  m = await launch('main');
  a = await launch('alt');
  if (!isOwner(await selfInfo(m, COMMON), 'main') || !isOwner(await selfInfo(a, COMMON), 'alt')) {
    log('!! 登录账号与预期不符，已停止');
    process.exitCode = 2;
  } else {
    let processed = 0, attempts = 0;
    const maxAttempts = Math.max(BATCH * 3, BATCH + 5);
    let paused = false;
    let needSkipDelay = false;
    const markFollowFail = (t, detail) => {
      t.main_follow = 'follow_fail';
      t.fail_count = (t.fail_count || 0) + 1;
      if (t.fail_count >= 5) {
        t.main_follow = 'skip_unknown';
        t.note = '关注重试5次仍失败(无限制提示), 转人工: ' + (t.note || '');
      } else {
        t.note = (t.note ? t.note + '; ' : '') + `${detail}(第${t.fail_count}次, 继续下一个)`;
      }
      log(`!! 大号${detail}, ${t.main_follow}`);
    };
    for (const t of todo) {
      if (processed >= BATCH || attempts >= maxAttempts || paused) break;
      if (needSkipDelay) { await sleep(randInt(1500, 3000)); needSkipDelay = false; }
      attempts++;
      log(`--- [${processed + 1}/${BATCH}] ${t.nickname} (抖音号 ${t.douyin_id}) ---`);

      // ---- MAIN: 大号关注 ----
      await openProfile(m, t.sec_uid);
      const idM = await verifyIdentity(m.page, t);
      let sM = await confirmRenamedStatus(m.page, t, idM);
      if (!idM.secOk || !idM.idOk || !idM.nameOk) {
        // 账号可能已注销/不存在 -> 页面无昵称/抖音号; 抓页面文本判定后永久跳过
        const pg = await m.page.evaluate(() => document.body?.innerText || '').catch(() => '');
        if (/不存在|注销/.test(pg)) {
          t.main_follow = 'skip_restricted';
          t.note = '账号不存在/已注销(大号侧): ' + pg.replace(/\s+/g, ' ').slice(0, 40);
          log(`!! 账号不存在/已注销, 跳过: ${t.note}`);
          saveLedger(rows);
          needSkipDelay = true;
          continue;
        }
        log(`!! 大号身份核对失败: ${JSON.stringify(idM.info)} 跳过, 待人工复核`);
        t.note = 'main身份核对失败:' + (idM.info.pageId || '') + '/' + idM.info.title;
        t.fail_count = (t.fail_count || 0) + 1;
        if (t.fail_count >= 3) { t.main_follow = 'id_check_fail'; t.note += '; 重试3次仍失败'; }
        saveLedger(rows);
        needSkipDelay = true;
        continue;
      }
      if (!sM) sM = await readStatus(m.page, t.sec_uid);
      if (sM.follow_status === 0) {
        if (Object.hasOwn(registry, t.sec_uid) || keepIds.has(t.sec_uid)) {
          t.main_follow = 'skip_protected';
          t.note = '目标在已取关登记表或保留名单中，已停止重新关注';
          saveLedger(rows);
          console.error('[WARN] 目标在已取关登记表或保留名单中，已停止重新关注: ' + t.nickname);
          needSkipDelay = true;
          continue;
        }
        if (UNFOLLOW_ONLY) {
          log(`[unfollow-only] ${t.nickname} 大号未关注, 跳过(待冷却后关注)`);
          t.note = (t.note ? t.note + '; ' : '') + 'unfollow-only跳过(待冷却关注)';
          saveLedger(rows);
          needSkipDelay = true;
          continue; // 不计 processed, 继续找下一个可安全取关的
        }
        const c = await clickFollow(m.page, 'follow');
        log(`大号点关注 => ${c}`);
        if (c.startsWith('mismatch:')) {
          await sleep(1500);
          const sMCheck = await readStatus(m.page, t.sec_uid);
          if (isFollowingStatus(sMCheck.follow_status)) {
            t.main_follow = 'already';
            t.fail_count = 0;
            t.note = clearNoteParts(t.note, 'main');
            saveLedger(rows);
            log(`大号复查已关注 (follow_status=${sMCheck.follow_status})`);
          } else {
            const risk = await riskIn(m.page);
            if (risk.length) {
              log(`!! 大号风控提示: ${risk.join(',')} 本轮回合暂停, 驱动器短冷却后重试`);
              t.note = 'main风控:' + risk.join(',');
              t.main_follow = 'risk_paused';
              saveLedger(rows);
              paused = true;
              break;
            }
            markFollowFail(t, '关注按钮文案不符:' + c.slice(9));
          }
        } else if (c === 'no-btn') {
          const risk = await riskIn(m.page);
          if (risk.length) {
            log(`!! 大号风控提示: ${risk.join(',')} 本轮回合暂停, 驱动器短冷却后重试`);
            t.note = 'main风控:' + risk.join(',');
            t.main_follow = 'risk_paused';
            saveLedger(rows);
            paused = true;
            break;
          }
          const toast = await captureToast(m.page, 1200);
          if (toast.length > 0) {
            t.main_follow = 'skip_restricted';
            t.note = '博主自身被限制/禁言(大号关注被拒): ' + toast.join(' | ');
            log(`!! 博主自身被限制/异常, 永久跳过: ${toast.join(' | ')}`);
          } else {
            markFollowFail(t, '未找到关注按钮');
          }
        } else {
          await sleep(randInt(3500, 5500));
          const sM2 = await readStatus(m.page, t.sec_uid);
          if (isFollowingStatus(sM2.follow_status)) {
            t.main_follow = 'done';
            t.main_follow_time = new Date().toISOString();
            t.fail_count = 0;
            t.note = clearNoteParts(t.note, 'main');
            saveLedger(rows);
            log(`大号关注成功 (follow_status=${sM2.follow_status})`);
          } else {
            const risk = await riskIn(m.page);
            if (risk.length) {
              log(`!! 大号风控提示: ${risk.join(',')} 本轮回合暂停, 驱动器短冷却后重试`);
              t.note = 'main风控:' + risk.join(',');
              t.main_follow = 'risk_paused';
              saveLedger(rows);
              paused = true;
              break;
            }
            // 抓取关注后的异常提示(toast), 判定是否为博主自身被限制/禁言擦边/注销
            const toast = await captureToast(m.page);
            if (toast.length > 0) {
              t.main_follow = 'skip_restricted';
              t.note = '博主自身被限制/禁言(大号关注被拒): ' + toast.join(' | ');
              log(`!! 博主自身被限制/异常, 永久跳过: ${toast.join(' | ')}`);
            } else {
              // 二次诊断: 按钮实际文案 + 延迟复查(排除接口缓存/慢写), 全部为0才判失败
              const btnTxt = await m.page.evaluate((selector) => document.querySelector(selector)?.textContent?.trim() || null, FOLLOW_BTN_SELECTOR).catch(() => null);
              await sleep(5000);
              const sM3 = await readStatus(m.page, t.sec_uid);
              log(`诊断: 按钮="${btnTxt}" 延迟复查follow_status=${sM3.follow_status}`);
              if (isFollowingStatus(sM3.follow_status)) {
                t.main_follow = 'done';
                t.main_follow_time = new Date().toISOString();
                t.fail_count = 0;
                t.note = clearNoteParts(t.note, 'main');
                saveLedger(rows);
                log(`大号关注成功(延迟复查确认 follow_status=${sM3.follow_status})`);
              } else {
                markFollowFail(t, '关注复查未变');
              }
            }
          }
        }
      } else if (isFollowingStatus(sM.follow_status)) {
        t.main_follow = 'already';
        t.fail_count = 0;
        t.note = clearNoteParts(t.note, 'main');
        saveLedger(rows);
        log(`大号原本已关注 (follow_status=${sM.follow_status})`);
      }

      // ---- ALT: 小号取关 (仅当大号已关注) ----
      if (t.main_follow === 'done' || t.main_follow === 'already') {
        try {
          await openProfile(a, t.sec_uid);
          const idA = await verifyIdentity(a.page, t);
          let sA = await confirmRenamedStatus(a.page, t, idA);
          if (!idA.secOk || !idA.idOk || !idA.nameOk) {
            log(`!! 小号身份核对失败: ${JSON.stringify(idA.info)} 跳过取关`);
            t.alt_fail_count = (t.alt_fail_count || 0) + 1;
            t.note = (t.note ? t.note + '; ' : '') + 'alt身份核对失败';
            if (t.alt_fail_count >= 3) { t.alt_unfollow = 'skip_id_fail'; t.note += '(重试3次)'; }
            saveLedger(rows);
            needSkipDelay = true;
            continue;
          }
          if (!sA) sA = await readStatus(a.page, t.sec_uid);
          if (isFollowingStatus(sA.follow_status)) {
            const c = await clickFollow(a.page, 'unfollow');
            log(`小号点取关 => ${c}`);
            if (c.startsWith('mismatch:')) {
              await sleep(1500);
              const sACheck = await readStatus(a.page, t.sec_uid);
              if (sACheck.follow_status === 0) {
                t.alt_unfollow = 'skip_not_following';
                t.note = (t.note ? t.note + '; ' : '') + 'alt侧未关注(异常)';
              } else {
                const risk = await riskIn(a.page);
                if (risk.length) {
                  log(`!! 小号风控: ${risk.join(',')} 暂停`);
                  t.note = (t.note ? t.note + '; ' : '') + 'alt风控:' + risk.join(',');
                  t.alt_unfollow = 'risk_paused';
                  saveLedger(rows);
                  paused = true;
                  break;
                }
                t.alt_unfollow = 'unfollow_fail';
                t.note = (t.note ? t.note + '; ' : '') + 'alt按钮文案不符:' + c.slice(9);
                log(`!! 小号取关按钮文案不符: ${c}`);
              }
            } else if (c === 'no-btn') {
              const risk = await riskIn(a.page);
              if (risk.length) {
                log(`!! 小号风控: ${risk.join(',')} 暂停`);
                t.note = (t.note ? t.note + '; ' : '') + 'alt风控:' + risk.join(',');
                t.alt_unfollow = 'risk_paused';
                saveLedger(rows);
                paused = true;
                break;
              }
              t.alt_unfollow = 'unfollow_fail';
              t.note = (t.note ? t.note + '; ' : '') + 'alt未找到取关按钮';
              log(`!! 小号未找到取关按钮`);
            } else {
              await sleep(randInt(2500, 4000));
              const handled = await clickConfirm(a.page);
              if (handled) log(`取关确认弹窗 => ${handled}`);
              await sleep(randInt(3500, 5500));
              const sA2 = await readStatus(a.page, t.sec_uid);
              if (sA2.follow_status === 0) {
                t.alt_unfollow = 'done';
                t.alt_unfollow_time = new Date().toISOString();
                t.alt_fail_count = 0;
                t.note = clearNoteParts(t.note, 'alt');
                log(`小号取关成功`);
              } else {
                const risk = await riskIn(a.page);
                if (risk.length) {
                  log(`!! 小号风控: ${risk.join(',')} 暂停`);
                  t.note = (t.note ? t.note + '; ' : '') + 'alt风控:' + risk.join(',');
                  t.alt_unfollow = 'risk_paused';
                  saveLedger(rows);
                  paused = true;
                  break;
                }
                t.alt_unfollow = 'unfollow_fail';
                t.note = (t.note ? t.note + '; ' : '') + 'alt取关复查未变';
                log(`!! 小号取关复查未变`);
              }
            }
          } else {
            t.alt_unfollow = 'skip_not_following';
            t.note = (t.note ? t.note + '; ' : '') + 'alt侧未关注(异常)';
            log(`小号侧该人 follow_status=${sA.follow_status}, 跳过取关`);
          }
        } catch (err) {
          saveLedger(rows);
          throw err;
        }
      }

      saveLedger(rows);
      processed++;
      log(`✓ 完成 ${t.nickname}: main=${t.main_follow} alt=${t.alt_unfollow}`);
      // 博主间仅留最小必要间隔(页面/请求缓冲), 限流由服务端时间窗口决定, 多等无益
      if (processed < BATCH && !paused) await sleep(randInt(8000, 15000));
    }

    log(`===== 本轮结束: 处理 ${processed} 个, 暂停=${paused} =====`);
  }
} finally {
  await m?.context?.close().catch(() => {});
  await a?.context?.close().catch(() => {});
}
process.exit(process.exitCode || 0);
