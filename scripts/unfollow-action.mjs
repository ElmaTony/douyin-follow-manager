import fs from 'node:fs';
import { sleep } from './lib.mjs';
import { confirmedStatus, currentOwner, isOwner, selfInfo } from './account-checks.mjs';
import { writeJson } from './core.mjs';

const COMMON = {
  device_platform: 'webapp', aid: '6383', channel: 'channel_pc_web', pc_client_type: '1',
  version_code: '170400', version_name: '17.4.0', cookie_enabled: 'true', platform: 'PC', downlink: '10',
};
async function readStatus(page, secUid) {
  const response = await page.evaluate(async ({ sec, common }) => {
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

export async function verifyMain(page) {
  if (!isOwner(await selfInfo({page},COMMON),'main')) throw new Error('大号身份异常，请检查登录账号');
}

async function verifyActiveOwner(page) {
  if (!isOwner(await currentOwner(page,COMMON),'main')) throw new Error('大号身份异常，本批已暂停');
}

const registryFile = 'data/unfollow_registry.json';
export function readRegistry() {
  const registry = fs.existsSync(registryFile) ? JSON.parse(fs.readFileSync(registryFile,'utf8')) : {entries:{}};
  if (!registry.entries || typeof registry.entries !== 'object' || Array.isArray(registry.entries)) throw new Error('取关登记表无法读取');
  return registry;
}

function register(item,code) {
  const registry = readRegistry();
  const now = new Date().toISOString();
  const previous = Object.hasOwn(registry.entries,item.sec_uid) ? registry.entries[item.sec_uid] : {};
  registry.entries[item.sec_uid] = {...previous,nickname:item.nickname,douyin_id:item.douyin_id,
    unfollowed_since:previous.unfollowed_since || now.slice(0,10), verified_at:now,
    reason:code==='done'?'人工决定取关，已在线复核':'人工决定取关，核对时已未关注',
    review_revision:item.rev || null};
  registry.updated = now;
  if (Array.isArray(registry.refollow_alerts)) registry.refollow_alerts = registry.refollow_alerts.filter(x=>x.sec_uid!==item.sec_uid);
  writeJson(registryFile,registry);
}

export function protectedAccounts() {
  const read = file => JSON.parse(fs.readFileSync('data/'+file+'.json','utf8'));
  return new Set([...read('user_keep_list').keeps,...read('ban_latest').filter(d=>d.status==='banned')].map(d=>d.sec_uid));
}

async function sitePause(page) {
  const warning = page.locator('[role="alert"],[role="dialog"],dialog,iframe[title*="验证"],[id*="captcha"]').filter({visible:true});
  for (const element of await warning.all()) {
    const text = [await element.textContent(),await element.getAttribute('title'),await element.getAttribute('id')].join(' ');
    if (/安全验证|滑动验证|验证码|captcha|操作频繁|操作过于频繁|请求过于频繁/i.test(text)) throw new Error('平台要求验证或稍后再试，本批已暂停');
  }
}

// Called once per confirmed author. A stale response must never toggle the button again.
export async function processUnfollow(page,item,{execute=false,stillPending=async()=>true,checkOwner=verifyActiveOwner}={}) {
  const url = 'https://www.douyin.com/user/'+encodeURIComponent(item.sec_uid);
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await sleep(3000);
  const identity = await page.evaluate(()=>({
    sec:location.pathname.split('/user/')[1]?.replace(/\/$/,''),
    id:document.body?.innerText?.match(/抖音号[:：]\s*([^\s]+)/)?.[1],
    title:document.title
  }));
  const failure = detail=>({code:'failed',detail});
  if (identity.sec!==item.sec_uid || (item.douyin_id && identity.id!==item.douyin_id) ||
      (execute && (!item.nickname || !item.douyin_id || !identity.title.includes(item.nickname)))) {
    if (execute) await sitePause(page);
    return failure('主页身份核对失败');
  }
  if (execute) await checkOwner(page);
  const status = await readStatus(page,item.sec_uid);
  if (status.restricted || protectedAccounts().has(item.sec_uid)) return failure('账号受保护');
  if (execute && (status.nickname !== item.nickname || (status.unique_id || status.short_id)!==item.douyin_id))
    return failure('线上身份与审阅名单不一致');
  if (execute && !await stillPending()) return failure('审阅决定已变化');
  if (status.follow_status===0) {
    if (execute) {
      await checkOwner(page);
      if (protectedAccounts().has(item.sec_uid) || !await stillPending()) return failure('登记前标记已变化');
      register(item,'absent');
    }
    return {code:'absent',detail:'核对时已未关注'};
  }
  if (!execute) return {code:'pending',detail:'待取关(dry-run)'};
  await sitePause(page);
  const control = page.locator('button[data-e2e="user-info-follow-btn"]:visible').filter({hasText:/^\s*(已关注|互相关注|相互关注|朋友)\s*$/});
  if (await control.count()===0) return failure('未找到已关注按钮');
  await checkOwner(page);
  if (protectedAccounts().has(item.sec_uid) || !await stillPending()) return failure('审阅决定或保护状态已变化');
  await control.first().click({timeout:4000});
  let confirmed = false;
  for (let check=0;check<5;check++) {
    await sleep(1100);
    if ((await readStatus(page,item.sec_uid)).follow_status===0) {
      await checkOwner(page);
      register(item,'done');
      return {code:'done',detail:'已取关并登记'};
    }
    await sitePause(page);
    if (!confirmed) {
      const explicit = page.getByRole('button',{name:/^(仍然取消关注|确认取消关注|取消关注)$/}).filter({visible:true});
      const scoped = page.locator('[role="dialog"]:visible,dialog[open]').filter({hasText:'取消关注'}).getByRole('button',{name:/^(确定|确认)$/});
      const button = explicit.or(scoped);
      if (await button.count()===1) {
        await checkOwner(page);
        if (protectedAccounts().has(item.sec_uid) || !await stillPending()) return failure('确认前标记已变化');
        await button.click({timeout:3000}); confirmed=true;
      }
    }
  }
  return failure('未核实取关成功，可稍后重新核对');
}
