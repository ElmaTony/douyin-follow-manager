/**
 * core.mjs — 共享纯工具（无浏览器依赖）
 *  · JSON 读写(原子写 + Windows 退避重试)
 *  · CSV 解析/转义/生成 + 报表防公式注入
 *  · 关注状态与台账状态枚举判定
 *  · 发布时间分级(90天+ / 30-90天 / 30天内)
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const RETRY_WAIT_BUF = new Int32Array(new SharedArrayBuffer(4));

export const readJson = (p, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
};

export function writeTextAtomic(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, text, 'utf8');
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(tmp, p);
        break;
      } catch (err) {
        if ((err?.code === 'EPERM' || err?.code === 'EACCES') && attempt < 3) {
          Atomics.wait(RETRY_WAIT_BUF, 0, 0, 40);
          continue;
        }
        throw err;
      }
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export const writeJson = (p, obj, space = 1) => writeTextAtomic(p, JSON.stringify(obj, null, space));

export const shanghaiDate = (date = new Date()) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(date);

export const localTimeStr = (date = new Date()) =>
  new Intl.DateTimeFormat('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);

/** 支持引号包裹/内嵌逗号/换行的 CSV 解析 */
export function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', inQ = false;
  const s = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (cur !== '' || row.length) { row.push(cur); rows.push(row); row = []; cur = ''; }
      if (ch === '\r' && s[i + 1] === '\n') i++;
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

export const escCsv = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export const csvText = (cols, rows, bom = true) =>
  (bom ? '\uFEFF' : '') + [cols.map(escCsv).join(','), ...rows.map((r) => r.map(escCsv).join(','))].join('\r\n');

export const escReportCsv = (v) => {
  let s = v == null ? '' : String(v).replace(/[\r\n\t]+/g, ' ');
  if (/^\s*[=+@-]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export const reportCsvText = (cols, rows, bom = true) =>
  (bom ? '\uFEFF' : '') + [cols.map(escReportCsv).join(','), ...rows.map((r) => r.map(escReportCsv).join(','))].join('\r\n');

export const isFollowingStatus = (s) => s === 1 || s === 2;
export const RETRYABLE_HELD_MAIN = ['skip_unknown', 'id_check_fail'];
export const HELD_MAIN = ['skip_restricted', 'skip_protected', ...RETRYABLE_HELD_MAIN];
export const isLedgerDone = (r) =>
  r?.alt_unfollow === 'done' ||
  ((r?.main_follow === 'done' || r?.main_follow === 'already') && r?.alt_unfollow === 'skip_not_following');
export const isLedgerHeld = (r) =>
  !isLedgerDone(r) && (HELD_MAIN.includes(r?.main_follow) || r?.alt_unfollow === 'skip_id_fail');
export const isLedgerRetryable = (r) =>
  !isLedgerDone(r) &&
  (RETRYABLE_HELD_MAIN.includes(r?.main_follow) ||
    r?.alt_unfollow === 'skip_id_fail' ||
    ['follow_fail', 'risk_paused'].includes(r?.main_follow) ||
    ['unfollow_fail', 'risk_paused'].includes(r?.alt_unfollow) ||
    (!isLedgerHeld(r) && ((r?.fail_count || 0) > 0 || (r?.alt_fail_count || 0) > 0)));
export const isLedgerPending = (r) => !isLedgerDone(r) && !isLedgerHeld(r);

/** 由发布时间数组得出最近更新/停更天数/分级 */
export function visibleTimes(account) {
  return Array.isArray(account?.posts) ? account.posts.map(p=>p.time) : account?.times || [];
}

export function localDate(date) {
  const pad = value => String(value).padStart(2,'0');
  return [date.getFullYear(),pad(date.getMonth()+1),pad(date.getDate())].join('-');
}

export function tierOf(times, nowSec = Date.now() / 1000) {
  const valid = (times || []).filter(t => Number.isFinite(t) && t > 1e9 && t < 4.1e9);
  const last = valid.length ? Math.max(...valid) : 0;
  const gap = last ? Math.max(0, Math.floor((nowSec - last) / 86400)) : null;
  const tier = gap == null ? 'nopost' : gap > 90 ? 'zombie' : gap > 30 ? 'low' : 'active';
  return { last, gap, tier, dateStr: last ? localDate(new Date(last * 1000)) : '' };
}

export const fmtFan = (n) => (n >= 10000 ? (n / 10000).toFixed(1) + 'w' : String(n ?? '-'));

export function snapshotTime(snapshot) {
  const time = Date.parse(snapshot?.exported_at);
  if (!Number.isFinite(time)) throw new Error('快照缺少有效的采集时间');
  return time / 1000;
}

export function lowWorksUncertainty(account,verified) {
  const works = verified?.works_fresh ?? account.works;
  if (verified?.secret) return '私密账号待核';
  if (works == null) return '作品数未知';
  return works < (account.posts?.length ?? account.n_visible ?? 0) ? '作品数与可见记录不符' : '';
}

export function staleAtSnapshot(account, asOf, verified, previous) {
  const visible = tierOf(visibleTimes(account),asOf);
  const historic = tierOf(visibleTimes(previous),asOf);
  // A recently observed post still rules out a 31-day break if it becomes hidden.
  if (!visible.last && historic.last && historic.gap<=30) return null;
  const fromHistory = Boolean(visible.last && historic.last > visible.last);
  const result = fromHistory ? historic : visible;
  if ((result.gap == null && (verified?.works_fresh ?? account.works) > 0) ||
      (result.gap > 30 && verified?.secret)) {
    return {...result, group:'unknown', reason:verified?.secret ? '私密账号，活动待核' : '有作品，无可见日期'};
  }
  if (result.gap == null || result.gap <= 30) return null;
  return { ...result, fromHistory, group: result.gap <= 90 ? 's3090' : result.gap <= 180 ? 's90180' : 's180' };
}

/** 读取生成页面内的静态快照，不执行页面脚本。 */
export function galleryPayload(html) {
  const match = html.match(/<script type="application\/json" id="gallery-data">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('画廊缺少快照，请重新生成');
  const payload = JSON.parse(match[1]);
  if (!Array.isArray(payload.data) || !Array.isArray(payload.protectedIds)) throw new Error('画廊数据格式错误');
  return payload;
}

export function reviewableRows(payload) {
  const locked = new Set(payload.protectedIds);
  return payload.data.filter(row => !row.badgeFix && !locked.has(row.sec_uid));
}

export const normText = (s) => String(s || '').normalize('NFKC').replace(/\s+/g, ' ').trim();

export function normalizeFileUrl(url) {
  const clean = String(url || '').split('#')[0];
  return process.platform === 'win32' && clean.startsWith('file:///') ? clean.toLowerCase() : clean;
}
