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

export function maxFollowingPages(expectedCount, perPage = 20) {
  return Math.max(300, Math.ceil((Number(expectedCount) || 0) / Math.max(1, perPage - 5)) + 30);
}

export async function waitProfileHydrated(page, { timeoutMs = 4500, fallbackMs = 3000 } = {}) {
  if (typeof page?.waitForFunction === 'function') {
    await page
      .waitForFunction(
        () => {
          const text = document.body?.innerText || '';
          return (
            location.pathname.includes('/user/') &&
            (/抖音号[:：]/.test(text) || /不存在|注销|验证|频繁|滑块/.test(text))
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
      const d = await r.json();
      const u = d?.user;
      const p = u?.punish_remind_info || null;
      return {
        status_code: d?.status_code,
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
