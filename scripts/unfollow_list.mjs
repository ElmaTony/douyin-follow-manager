import fs from 'node:fs';
import { parseCsv } from './core.mjs';

function csvItems(text) {
  const [header = [], ...rows] = parseCsv(text);
  const col = names => header.findIndex(cell => names.some(name => cell.trim().includes(name)));
  const nick = col(['昵称']), id = col(['抖音号']), sec = col(['sec_uid']), link = col(['主页链接', '链接']), keep = col(['保留']);
  if (nick < 0 || id < 0 || (sec < 0 && link < 0)) throw new Error('CSV 需要昵称、抖音号，以及 sec_uid 或主页链接列');
  return rows.map((r, i) => {
    const linkedId = (r[link] || '').trim().match(/^https?:\/\/(?:www\.)?douyin\.com\/user\/([\w-]+)\/?(?:[?#].*)?$/i)?.[1];
    const given = (r[sec] || '').trim();
    if (given && linkedId && given !== linkedId) throw new Error('第 ' + (i+2) + ' 行的链接与账号标识不符');
    const flag = (r[keep] || '').trim();
    if (!['','0','1'].includes(flag)) throw new Error('第 ' + (i+2) + ' 行保留标记无效');
    return {sec_uid:given || linkedId, nickname:(r[nick] || '').trim(), douyin_id:(r[id] || '').trim(), keep:flag==='1'};
  });
}

function decisionItems(text) {
  return text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim()).map((line, i) => {
    const fields = line.split('\t');
    const [sec_uid, nickname, douyin_id, decision] = fields;
    if (fields.length !== 4 || !['保留','取关','未审','未标','待复核'].includes(decision)) {
      throw new Error('第 ' + (i+1) + ' 行不是画廊导出的四列决定名单');
    }
    return {sec_uid, nickname, douyin_id, keep:decision !== '取关'};
  });
}

export function loadUnfollowList(file, limit = 0) {
  const text = fs.readFileSync(file, 'utf8');
  const items = /\.(txt|tsv)$/i.test(file) ? decisionItems(text) : csvItems(text);
  if (!items.length) throw new Error('名单为空');
  const keeps = JSON.parse(fs.readFileSync('data/user_keep_list.json', 'utf8'));
  const bans = JSON.parse(fs.readFileSync('data/ban_latest.json', 'utf8'));
  const protectedIds = new Set([...keeps.keeps.map(d => d.sec_uid), ...bans.filter(d => d.status === 'banned').map(d => d.sec_uid)]);
  const unique = new Map();
  for (const item of items) {
    if (!item.sec_uid || !/^[\w-]+$/.test(item.sec_uid)) throw new Error('名单中有缺失或无效的 sec_uid');
    const existing = unique.get(item.sec_uid);
    if (existing && (existing.nickname !== item.nickname || existing.douyin_id !== item.douyin_id)) throw new Error('同一账号出现了不一致的身份信息');
    item.keep ||= protectedIds.has(item.sec_uid) || Boolean(existing?.keep);
    unique.set(item.sec_uid,item);
  }
  const candidates = [...unique.values()].filter(d => !d.keep);
  return { total:items.length, duplicate:items.length-unique.size, excluded:unique.size-candidates.length, items:limit ? candidates.slice(0,limit) : candidates };
}
