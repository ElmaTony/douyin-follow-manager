import { sleep } from './lib.mjs';

import { binding } from './local-state.mjs';

export function isOwner(user, which) {
  const owner = binding(which);
  const other = binding(which === 'main' ? 'alt' : 'main');
  return Boolean(owner?.sec_uid && owner.short_id && other?.sec_uid !== owner.sec_uid &&
    user?.status_code === 0 && user.short_id === owner.short_id && user.sec_uid === owner.sec_uid);
}

export function confirmedStatus(response, secUid) {
  const status = response?.follow_status;
  if (response?.status_code !== 0 || response.sec_uid !== secUid || (status !== 0 && status !== 1)) {
    throw new Error('无法确认目标账号的关注状态，已停止');
  }
  return status;
}

export async function selfInfo(ctx, common) {
  await ctx.page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await sleep(4000);
  return currentOwner(ctx.page,common);
}

export function currentOwner(page,common) {
  return page.evaluate(async (common) => {
    const qs = new URLSearchParams({ ...common, source_type: '1', publish_video_strategy_type: '2' });
    const r = await fetch('https://www.douyin.com/aweme/v1/web/user/profile/self/?' + qs, {
      headers: { accept: 'application/json', referer: 'https://www.douyin.com/' }, credentials: 'include',
    });
    const d = await r.json();
    return {
      status_code: d?.status_code, nickname: d?.user?.nickname, sec_uid: d?.user?.sec_uid,
      short_id: d?.user?.short_id ? String(d.user.short_id) : '', uid: d?.user?.uid,
      following_count: d?.user?.following_count,
    };
  }, common);
}
