import fs from 'node:fs';
import { sleep } from './lib.mjs';
import { confirmedStatus, currentOwner, isOwner, selfInfo } from './account-checks.mjs';
import { normText, shanghaiDate, writeJson } from './core.mjs';
import { COMMON, FOLLOW_BTN_SELECTOR, FOLLOWING_BTN_RE, fetchProfileOther, inspectProfileDom, waitProfileHydrated } from './douyin-api.mjs';

async function readStatus(page, secUid) {
  const response = await fetchProfileOther(page, secUid, COMMON);
  confirmedStatus(response, secUid);
  return { ...response, restricted: response.is_punish };
}

export async function verifyMain(page) {
  if (!isOwner(await selfInfo({ page }, COMMON), 'main')) throw new Error('大号身份异常，请检查登录账号');
}

async function verifyActiveOwner(page) {
  if (!isOwner(await currentOwner(page, COMMON), 'main')) throw new Error('大号身份异常，本批已暂停');
}

const registryFile = 'data/unfollow_registry.json';
export function readRegistry() {
  const registry = fs.existsSync(registryFile) ? JSON.parse(fs.readFileSync(registryFile, 'utf8')) : { entries: {} };
  if (!registry.entries || typeof registry.entries !== 'object' || Array.isArray(registry.entries)) throw new Error('取关登记表无法读取');
  return registry;
}

function register(item, code) {
  const registry = readRegistry();
  const now = new Date().toISOString();
  const previous = Object.hasOwn(registry.entries, item.sec_uid) ? registry.entries[item.sec_uid] : {};
  registry.entries[item.sec_uid] = {
    ...previous,
    nickname: item.nickname,
    douyin_id: item.douyin_id,
    unfollowed_since: previous.unfollowed_since || shanghaiDate(new Date(now)),
    verified_at: now,
    reason: code === 'done' ? '人工决定取关，已在线复核' : '人工决定取关，核对时已未关注',
    review_revision: item.rev || null,
  };
  registry.updated = now;
  if (Array.isArray(registry.refollow_alerts)) {
    registry.refollow_alerts = registry.refollow_alerts.filter((x) => x.sec_uid !== item.sec_uid);
  }
  writeJson(registryFile, registry);
}

export function protectedAccounts() {
  const read = (file) => JSON.parse(fs.readFileSync('data/' + file + '.json', 'utf8'));
  return new Set([...read('user_keep_list').keeps, ...read('ban_latest').filter((d) => d.status === 'banned')].map((d) => d.sec_uid));
}

async function sitePause(page) {
  const warning = page.locator('[role="alert"],[role="dialog"],dialog,iframe[title*="验证"],[id*="captcha"]').filter({ visible: true });
  for (const element of await warning.all()) {
    const text = [await element.textContent(), await element.getAttribute('title'), await element.getAttribute('id')].join(' ');
    if (/安全验证|滑动验证|验证码|captcha|操作频繁|操作过于频繁|请求过于频繁/i.test(text)) {
      throw new Error('平台要求验证或稍后再试，本批已暂停');
    }
  }
}

// Called once per confirmed author. A stale response must never toggle the button again.
export async function processUnfollow(page, item, { execute = false, stillPending = async () => true, checkOwner = verifyActiveOwner } = {}) {
  const url = 'https://www.douyin.com/user/' + encodeURIComponent(item.sec_uid);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitProfileHydrated(page);
  const identity = await inspectProfileDom(page);
  const failure = (detail) => ({ code: 'failed', detail });
  if (
    identity.sec !== item.sec_uid ||
    (item.douyin_id && identity.id !== item.douyin_id) ||
    (execute && (!item.nickname || !item.douyin_id || !normText(identity.title).includes(normText(item.nickname))))
  ) {
    if (execute) await sitePause(page);
    return failure('主页身份核对失败');
  }
  if (execute) await checkOwner(page);
  const status = await readStatus(page, item.sec_uid);
  if (status.restricted || protectedAccounts().has(item.sec_uid)) return failure('账号受保护');
  const idMatched = !item.douyin_id || status.unique_id === item.douyin_id || status.short_id === item.douyin_id;
  if (execute && (normText(status.nickname) !== normText(item.nickname) || !idMatched)) {
    return failure('线上身份与审阅名单不一致');
  }
  if (execute && !(await stillPending())) return failure('审阅决定已变化');
  if (status.follow_status === 0) {
    if (execute) {
      await checkOwner(page);
      if (protectedAccounts().has(item.sec_uid) || !(await stillPending())) return failure('登记前标记已变化');
      register(item, 'absent');
    }
    return { code: 'absent', detail: '核对时已未关注' };
  }
  if (!execute) return { code: 'pending', detail: '待取关(dry-run)' };
  await sitePause(page);
  const control = page.locator(FOLLOW_BTN_SELECTOR + ':visible').filter({ hasText: FOLLOWING_BTN_RE });
  if ((await control.count()) === 0) return failure('未找到已关注按钮');
  await checkOwner(page);
  if (protectedAccounts().has(item.sec_uid) || !(await stillPending())) return failure('审阅决定或保护状态已变化');
  await control.first().click({ timeout: 4000 });
  let confirmed = false;
  for (let check = 0; check < 5; check++) {
    await sleep(1100);
    if ((await readStatus(page, item.sec_uid)).follow_status === 0) {
      await checkOwner(page);
      register(item, 'done');
      return { code: 'done', detail: '已取关并登记' };
    }
    await sitePause(page);
    if (!confirmed) {
      const scoped = page
        .locator('[role="dialog"]:visible,dialog[open]')
        .filter({ hasText: '取消关注' })
        .getByRole('button', { name: /^(确定|确认|仍然取消关注|确认取消关注|取消关注)$/ });
      const explicit = page.getByRole('button', { name: /^(仍然取消关注|确认取消关注)$/ }).filter({ visible: true });
      const button = (await scoped.count()) === 1 ? scoped : (await explicit.count()) === 1 ? explicit : null;
      if (button) {
        await checkOwner(page);
        if (protectedAccounts().has(item.sec_uid) || !(await stillPending())) return failure('确认前标记已变化');
        await button.click({ timeout: 3000 });
        confirmed = true;
      }
    }
  }
  return failure('未核实取关成功，可稍后重新核对');
}
