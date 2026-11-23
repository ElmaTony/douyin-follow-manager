/**
 * snapshot_main — 全量快照: 主号关注列表 + 每人最近20条作品
 *  输出 data/snapshot_latest.json: { exported_at, accounts: { sec: {nickname,douyin_id,signature,followers,works,
 *    covers[],captions[],times[],aigc_n,n_visible,fetch} } }
 *  节奏: 3.2-4.6s/人 + 连续失败冷却 120s (9/30 教训: 快节奏会静默丢数据)
 */
import { launch, sleep } from './lib.mjs';
import { isOwner, selfInfo } from './account-checks.mjs';
import { writeJson } from './core.mjs';

const COMMON = {
  device_platform: 'webapp', aid: '6383', channel: 'channel_pc_web', pc_client_type: '1',
  version_code: '170400', version_name: '17.4.0', cookie_enabled: 'true', platform: 'PC', downlink: '10',
};

const OUT = 'data/snapshot_latest.json';
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
        signature: u.signature || '', followers: u.follower_count || 0, works: u.aweme_count || 0,
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
  const snap = { exported_at: new Date().toISOString(), accounts: {} };
  let i = 0, ok = 0, empty = 0, consec = 0, cooldowns = 0;
  for (const [sec, a] of list) {
    i++;
    try {
      const res = await page.evaluate(async ({ sec, common }) => {
        const qs = new URLSearchParams({
          ...common, sec_user_id: sec, count: '20', max_cursor: '0',
          locate_query: 'false', source: 'channel_pc_web',
        });
        const r = await fetch('https://www.douyin.com/aweme/v1/web/aweme/post/?' + qs, {
          headers: { accept: 'application/json', referer: 'https://www.douyin.com/' }, credentials: 'include',
        });
        const txt = await r.text();
        let j; try { j = JSON.parse(txt); } catch { return { bad: true }; }
        if (!Array.isArray(j?.aweme_list) && j?.aweme_list !== null) return {bad:true};
        const list = j.aweme_list || [];
        const covers = [], caps = [];
        for (const x of list) {
          const urls = x?.video?.cover?.url_list || [];
          if (urls.length) covers.push(urls[1] || urls[0]);
          if (x?.desc) caps.push(String(x.desc).replace(/\s+/g, ' ').slice(0, 60));
          if (covers.length >= 9) break;
        }
        return {
          bad: false, status: j?.status_code, n: list.length,
          times: list.map((x) => x?.create_time || 0),
          aigc_n: list.filter((x) => x?.is_aigc_media === true).length,
          covers, caps: caps.slice(0, 5),
        };
      }, { sec, common: COMMON });
      if (res.bad) { a.fetch = 'empty-body'; empty++; consec++; }
      else {
        a.fetch = res.status === 0 ? 'ok' : 'status_' + res.status;
        a.times = res.times; a.covers = res.covers; a.captions = res.caps;
        a.aigc_n = res.aigc_n; a.n_visible = res.n;
        if (res.status === 0) { ok++; consec = 0; } else consec++;
      }
    } catch (e) { a.fetch = 'ERR:' + e.message.slice(0, 30); consec++; }
    snap.accounts[sec] = a;

    if (consec >= 3 && cooldowns < 12) {
      cooldowns++; consec = 0;
      log(`!! 连续失败, 冷却 120 秒 (第 ${cooldowns} 次)`);
      await sleep(120000);
    }
    if (i % 20 === 0) { log(`进度 ${i}/${list.size} (ok ${ok}, 空 ${empty})`); }
    await sleep(3200 + Math.floor(Math.random() * 1400));
  }
  if (ok !== list.size) throw new Error('部分作品资料核验失败，已保留原快照');
  writeJson(OUT, snap);
  log(`===== 完成: ${list.size} 人, ok ${ok}, 空响应 ${empty}, 冷却 ${cooldowns} 次 -> ${OUT} =====`);
} finally {
  await m.context.close();
}
