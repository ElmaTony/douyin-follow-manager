/** 只在大号关注列表完整核验后，更新本地已取关登记表。 */
import fs from 'node:fs';
import path from 'node:path';
import { launch, sleep } from './lib.mjs';
import { isOwner, selfInfo } from './account-checks.mjs';
import { writeJson } from './core.mjs';

const COMMON = {
  device_platform:'webapp', aid:'6383', channel:'channel_pc_web', pc_client_type:'1',
  version_code:'170400', version_name:'17.4.0', cookie_enabled:'true', platform:'PC', downlink:'10',
};
const out = 'data/unfollow_registry.json';
const today = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Taipei'}).format(new Date());
const registry = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {entries:{}};
if (!registry.entries || typeof registry.entries !== 'object' || Array.isArray(registry.entries)) throw new Error('登记表格式错误');

const current = new Map();
const main = await launch('main');
try {
  const owner = await selfInfo(main, COMMON);
  if (!isOwner(owner, 'main') || !Number.isSafeInteger(owner.following_count)) throw new Error('大号身份或关注总数无法核实');
  let cursor = '0', complete = false;
  for (let page = 0; page < 150; page++) {
    const response = await main.page.evaluate(async ({common,sec,cursor}) => {
      const query = new URLSearchParams({...common,sec_user_id:sec,count:'20',max_time:cursor,min_time:'0',offset:'0',source_type:'0',publish_video_strategy_type:'2'});
      const result = await fetch('https://www.douyin.com/aweme/v1/web/user/following/list/?' + query, {credentials:'include'});
      return result.json();
    }, {common:COMMON, sec:owner.sec_uid, cursor});
    if (response?.status_code !== 0 || !Array.isArray(response.followings) || ![true,false,0,1].includes(response.has_more)) throw new Error('关注列表返回不完整，保留上次登记表');
    for (const u of response.followings) {
      if (!u.sec_uid) throw new Error('关注列表包含未识别账号');
      current.set(u.sec_uid,{sec_uid:u.sec_uid,nickname:u.nickname || '',douyin_id:u.unique_id || u.short_id || '',aweme_count:u.aweme_count ?? 0,follower_count:u.follower_count ?? 0});
    }
    if (!response.has_more) { complete = true; break; }
    const next = String(response.min_time ?? '');
    if (!response.followings.length || !next || next === cursor) break;
    cursor = next;
    await sleep(800);
  }
  if (!complete || current.size !== owner.following_count) throw new Error('关注列表未取全，保留上次登记表');
} finally {
  await main.context.close();
}

const history = new Map();
for (const file of fs.readdirSync('data')) {
  const match = /^main_following_(\d{4}-\d{2}-\d{2})\.json$/.exec(file);
  if (match && match[1] < today) history.set(match[1],path.join('data',file));
}
const dates = [...history.keys()].sort();
const lastSeen = new Map();
for (const [i,date] of dates.entries()) {
  const rows = JSON.parse(fs.readFileSync(history.get(date),'utf8'));
  if (!Array.isArray(rows)) throw new Error('历史关注快照格式错误');
  for (const u of rows) if (u.sec_uid) lastSeen.set(u.sec_uid,{u,date,next:dates[i+1] || today});
}
for (const [sec,{u,date,next}] of lastSeen) {
  if (current.has(sec) || Object.hasOwn(registry.entries,sec)) continue;
  registry.entries[sec] = {nickname:u.nickname,douyin_id:u.douyin_id || u.unique_id || u.short_id || '',
    last_seen:date,unfollowed_since:next,reason:'完整关注列表比对：' + date + ' 仍在关注，' + next + ' 已移出'};
}
registry.refollow_alerts = Object.entries(registry.entries).filter(([sec]) => current.has(sec))
  .map(([sec,e]) => ({...e,current_nickname:current.get(sec).nickname,sec_uid:sec}));
registry.updated = new Date().toISOString();
writeJson('data/main_following_' + today + '.json',[...current.values()]);
writeJson(out,registry);
console.log('登记表更新完成。大号关注 ' + current.size + ' 人，登记 ' + Object.keys(registry.entries).length + ' 人，疑似重新关注 ' + registry.refollow_alerts.length + ' 人。');
