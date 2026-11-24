/**
 * snapshot_main — 全量快照: 主号关注列表 + 每人最近20条作品
 *  输出 data/snapshot_latest.json: { exported_at, accounts: { sec: {nickname,douyin_id,signature,followers,works,
 *    covers[],captions[],times[],aigc_n,n_visible,fetch} } }
 *  节奏: 3.2-4.6s/人 + 连续失败冷却 120s (9/30 教训: 快节奏会静默丢数据)
 */
import { launch, sleep } from './lib.mjs';
import { isOwner, selfInfo } from './account-checks.mjs';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from './core.mjs';

import { readRecentWorks } from './recent-works.mjs';

const COMMON = {
  device_platform: 'webapp', aid: '6383', channel: 'channel_pc_web', pc_client_type: '1',
  version_code: '170400', version_name: '17.4.0', cookie_enabled: 'true', platform: 'PC', downlink: '10',
};

const OUT = 'data/snapshot_latest.json';
const progressFile = fileURLToPath(new URL('../data/.snapshot-progress.json',import.meta.url));
const publishedFile = fileURLToPath(new URL('../data/snapshot_latest.json',import.meta.url));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const m = await launch('main');
const page = m.page;
try {
  const owner = await selfInfo(m, COMMON);
  if (!isOwner(owner, 'main') || !Number.isSafeInteger(owner.following_count)) throw new Error('大号身份或关注总数无法核实');

  // ---- 1) 关注列表 ----
  const list = new Map();
  let maxTime = 0, pageNo = 0, hasMore = true, fails = 0;
  while (hasMore && pageNo < 150) {
    pageNo++;
    const res = await page.evaluate(async ({ sec, maxTime, common }) => {
      const qs = new URLSearchParams({
        ...common, sec_user_id: sec, count: '20', max_time: String(maxTime),
        min_time: '0', offset: '0', source_type: '0', publish_video_strategy_type: '2',
      });
      const r = await fetch('https://www.douyin.com/aweme/v1/web/user/following/list/?' + qs, {
        headers: { accept: 'application/json', referer: 'https://www.douyin.com/' }, credentials: 'include',
      });
      return await r.json();
    }, { sec: owner.sec_uid, maxTime, common: COMMON });
    if (res?.status_code !== 0) { if (++fails > 3) break; log('列表页失败重试'); await sleep(5000); continue; }
    fails = 0;
    if (!Array.isArray(res.followings) || ![0,1,true,false].includes(res.has_more)) throw new Error('关注列表缺少完整性信息');
    hasMore = Boolean(res.has_more);
    const users = res.followings || [];
    if (!users.length) break;
    if (hasMore && (!res.min_time || String(res.min_time) === String(maxTime))) throw new Error('关注列表分页未完成');
    maxTime = res.min_time;
    for (const u of users) {
      if (!u.sec_uid) throw new Error('关注列表中有未知账号');
      if (list.has(u.sec_uid)) continue;
      list.set(u.sec_uid, {
        sec_uid: u.sec_uid, nickname: u.nickname || '', douyin_id: u.unique_id || u.short_id || '',
        signature: u.signature || '', followers: u.follower_count || 0, works: Number.isInteger(u.aweme_count) ? u.aweme_count : null,
        covers: [], captions: [], times: [], aigc_n: 0, n_visible: 0, fetch: 'pending',
      });
    }
    if (pageNo % 10 === 0) log(`列表 ${pageNo} 页 / ${list.size} 人`);
    if (!hasMore) break;
    await sleep(700);
  }
  if (hasMore || list.size !== owner.following_count) throw new Error('关注列表不完整，已保留原快照');
  log(`关注列表: ${list.size} 人, 开始逐人抓作品...`);

  // ---- 2) 逐人作品 ----
  const cached = readJson(progressFile);
  const age = Date.now() - Date.parse(cached?.exported_at);
  const resume = cached?.owner === owner.sec_uid && age >= 0 && age <= 6*3600000 &&
    cached.exported_at !== readJson(publishedFile)?.exported_at &&
    cached.accounts && typeof cached.accounts === 'object';
  const checkedAt = new Date().toISOString();
  const snap = { exported_at: resume ? cached.exported_at : checkedAt, following_checked_at:checkedAt, accounts:Object.fromEntries(list) };
  const saveProgress = () => writeJson(progressFile,{owner:owner.sec_uid,...snap});
  const reusable = (sec,a) => resume && cached.accounts[sec]?.fetch === 'ok' && cached.accounts[sec].works === a.works;
  let reused = 0;
  for (const [sec,a] of list) {
    if (!reusable(sec,a)) continue;
    const saved = cached.accounts[sec];
    for (const key of ['posts','fetch','times','covers','captions','aigc_n','n_visible','works_checked_at']) {
      if (Object.hasOwn(saved,key)) a[key] = saved[key];
    }
    reused++;
  }
  if (resume) log('续采：本次关注名单中已有 '+reused+' 人的作品可用，其余逐人补查。');
  let processed = 0, ok = reused, empty = [...list.values()].filter(a=>a.fetch==='ok' && !a.n_visible).length, consec = 0, cooldowns = 0;
  for (const [sec, a] of list) {
    if (a.fetch === 'ok') continue;
    processed++;
    try {
      a.posts = await readRecentWorks(page,sec,COMMON);
      a.fetch = 'ok';
      a.works_checked_at = new Date().toISOString();
      a.times = a.posts.map(p=>p.time);
      a.covers = a.posts.filter(p=>p.cover).slice(0,9).map(p=>p.cover);
      a.captions = a.posts.filter(p=>p.caption).map(p=>p.caption.slice(0,120));
      a.aigc_n = a.posts.filter(p=>p.ai).length;
      a.n_visible = a.posts.length;
      ok++; consec = 0;
      if (!a.n_visible) empty++;
    } catch (e) {
      a.fetch = 'ERR:' + e.message.slice(0, 30);
      if (page.isClosed?.()) { saveProgress(); throw new Error('采集窗口已关闭，已保存作品进度，重新在线更新即可续采'); }
      consec++;
    }
    if (processed % 20 === 0 || a.fetch !== 'ok') saveProgress();

    if (consec >= 3 && cooldowns < 12) {
      cooldowns++; consec = 0;
      log(`!! 连续失败, 冷却 120 秒 (第 ${cooldowns} 次)`);
      await sleep(120000);
    }
    if (processed % 20 === 0) { log(`进度 ${reused+processed}/${list.size} (ok ${ok}, 无可见作品 ${empty})`); }
    await sleep(3200 + Math.floor(Math.random() * 1400));
  }
  saveProgress();
  if (ok !== list.size) throw new Error('部分作品资料待补采，已保存本轮进度。稍后在线更新会从缺项继续。');
  writeJson(OUT, snap);
  log(`===== 完成: ${list.size} 人, ok ${ok}, 无可见作品 ${empty}, 冷却 ${cooldowns} 次 -> ${OUT} =====`);
} finally {
  await m.context.close();
}
