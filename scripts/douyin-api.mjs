/**
 * douyin-api.mjs — 抖音网页端公共请求参数、分页上限计算、自适应页面水合与他人资料请求封装
 */
import { sleep } from './lib.mjs';

export const COMMON = Object.freeze({
  device_platform: 'webapp',
  aid: '6383',
  channel: 'channel_pc_web',
  pc_client_type: '1',
  version_code: '170400',
  version_name: '17.4.0',
  cookie_enabled: 'true',
  platform: 'PC',
  downlink: '10',
});

export const FOLLOW_BTN_SELECTOR = 'button[data-e2e="user-info-follow-btn"]';
export const FOLLOWING_BTN_RE = /^\s*(已关注|互相关注|相互关注|朋友)\s*$/;
export const FOLLOW_ACTION_RE = /^\s*\+?\s*(关注|回关)\s*$/;
export const RISK_PATTERNS = ['滑动验证', '安全验证', '验证码', '滑块', '操作过于频繁', '请求过于频繁', '稍后再试', '请稍后重试', '操作频繁'];

export function inspectProfileDom(page) {
  return page.evaluate(() => {
    const sec = (location.pathname.split('/user/')[1] || '').split('?')[0].replace(/\/$/, '');
    const rawId = document.body?.innerText?.match(/抖音号[:：]\s*([^\s｜|]+)/)?.[1] || '';
    const id = rawId.replace(/IP属地[:：]?.*$/, '') || null;
    return { sec, id, title: document.title || '' };
  });
}

export function maxFollowingPages(expectedCount, perPage = 20) {
  return Math.max(300, Math.ceil((Number(expectedCount) || 0) / Math.max(1, perPage - 5)) + 30);
}

export async function waitProfileHydrated(page, { timeoutMs = 4500, fallbackMs = 3000 } = {}) {
  if (typeof page?.waitForFunction === 'function') {
    await page
      .waitForFunction(
        () => {
          const text = document.body?.innerText || '';
          const title = document.title ? document.title.trim() : '';
          return (
            location.pathname.includes('/user/') &&
            ((/抖音号[:：]/.test(text) && title && !/^抖音[-—\s]*记录美好生活$/.test(title)) ||
              /不存在|注销|验证|频繁|滑块/.test(text))
          );
        },
        undefined,
        { timeout: timeoutMs }
      )
      .catch(() => {});
    await sleep(300);
    return;
  }
  await sleep(fallbackMs);
}

export async function fetchFollowingList(
  page,
  secUid,
  expectedCount,
  { common = COMMON, onPage, retryLimit = 3, pageDelayMs = () => 800 } = {}
) {
  const maxPages = maxFollowingPages(expectedCount);
  const map = new Map();
  let cursor = '0';
  let pageNo = 0;
  let hasMore = true;
  let fails = 0;
  while (hasMore && pageNo < maxPages) {
    let res;
    try {
      res = await page.evaluate(
        async ({ sec, cursor, common }) => {
          const qs = new URLSearchParams({
            ...common,
            sec_user_id: sec,
            count: '20',
            max_time: String(cursor),
            min_time: '0',
            offset: '0',
            source_type: '0',
            publish_video_strategy_type: '2',
          });
          const r = await fetch('https://www.douyin.com/aweme/v1/web/user/following/list/?' + qs, {
            headers: { accept: 'application/json', referer: 'https://www.douyin.com/' },
            credentials: 'include',
          });
          return await r.json();
        },
        { sec: secUid, cursor, common }
      );
    } catch {
      res = null;
    }
    if (res?.status_code !== 0) {
      if (++fails <= retryLimit) {
        await sleep(2500);
        continue;
      }
      break;
    }
    fails = 0;
    pageNo++;
    if (!Array.isArray(res.followings) || ![0, 1, true, false].includes(res.has_more)) {
      throw new Error('关注列表返回不完整');
    }
    for (const u of res.followings) {
      if (!u?.sec_uid) throw new Error('关注列表包含未识别账号');
      if (!map.has(u.sec_uid)) map.set(u.sec_uid, u);
    }
    hasMore = Boolean(res.has_more);
    onPage?.({
      pageNo,
      pageItems: res.followings,
      totalLoaded: map.size,
      totalReported: res.total,
      hasMore,
    });
    if (!hasMore) break;
    const next = String(res.min_time ?? '');
    if (!res.followings.length || !next || next === String(cursor)) break;
    cursor = next;
    const delay = typeof pageDelayMs === 'function' ? pageDelayMs() : pageDelayMs;
    if (delay > 0) await sleep(delay);
  }
  if (hasMore || !Number.isSafeInteger(expectedCount) || map.size !== expectedCount) {
    throw new Error(`关注列表未完整导出 (${map.size}/${expectedCount})`);
  }
  return [...map.values()];
}

export function fetchProfileOther(page, secUid, common = COMMON) {
  return page.evaluate(
    async ({ secUid, common }) => {
      const qs = new URLSearchParams({
        ...common,
        sec_user_id: secUid,
        source_type: '4',
        publish_video_strategy_type: '2',
      });
      const r = await fetch('https://www.douyin.com/aweme/v1/web/user/profile/other/?' + qs, {
        headers: { accept: 'application/json', referer: 'https://www.douyin.com/' },
        credentials: 'include',
      });
      let d;
      try {
        d = await r.json();
      } catch {
        throw new Error('接口返回非 JSON 内容（可能触发平台验证或登录失效）');
      }
      const u = d?.user;
      const p = u?.punish_remind_info || null;
      return {
        status_code: d?.status_code,
        status_msg: d?.status_msg || '',
        sec_uid: u?.sec_uid,
        follow_status: u?.follow_status,
        nickname: u?.nickname,
        unique_id: u?.unique_id ? String(u.unique_id) : '',
        short_id: u?.short_id ? String(u.short_id) : '',
        secret: u?.secret || 0,
        works: u?.aweme_count ?? null,
        is_punish: Boolean(p && (p.is_punish || p.prompt_bar?.content)),
        punish_text: p?.punish_content?.content || p?.prompt_bar?.content || '',
      };
    },
    { secUid, common }
  );
}
