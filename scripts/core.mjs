/**
 * core.mjs — 共享纯工具（无浏览器依赖）
 *  · JSON 读写(原子写)
 *  · CSV 解析/转义/生成
 *  · 发布时间分级(90天+ / 30-90天 / 30天内)
 */
import fs from 'node:fs';
import path from 'node:path';

export const readJson = (p, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
};

export const writeJson = (p, obj) => {
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1), 'utf8');
  fs.renameSync(tmp, p);
};

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
  (bom ? '\uFEFF' : '') + [cols.join(','), ...rows.map((r) => r.map(escCsv).join(','))].join('\r\n');

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
