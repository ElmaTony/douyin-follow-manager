/**
 * scan_bans_latest — 处罚状态核验(新版)
 *  范围: 低作品数及阈值附近、活动待核或停更、改名及内容变化线索
 *  依据: user.punish_remind_info(仅受罚号有) + secret
 *  输出 data/ban_latest.json
 */
import { fileURLToPath } from 'node:url';
import { launch, sleep } from './lib.mjs';
import { selfInfo, isOwner } from './account-checks.mjs';
import { COMMON, fetchProfileOther } from './douyin-api.mjs';
import { readRecentWorks } from './recent-works.mjs';
import { readJson, writeJson, snapshotTime, staleAtSnapshot } from './core.mjs';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const snap = readJson('data/snapshot_latest.json');
if (!snap) { console.error('缺少 snapshot_latest.json'); process.exit(1); }
const suspects = readJson('data/suspects_latest.json') || [];

const previous = readJson('data/snapshot_previous.json')?.accounts || {};
const asOf = snapshotTime(snap);
const changedIds = new Set(suspects.map((row) => row.sec_uid));
const targets = new Map();
for (const [sec, a] of Object.entries(snap.accounts)) {
  if ((a.works ?? 0) <= 24 || previous[sec]?.works < 20 || staleAtSnapshot(a, asOf, undefined, previous[sec])) {
    targets.set(sec, a.nickname);
  }
}
for (const s of suspects) if (!targets.has(s.sec_uid)) targets.set(s.sec_uid, s.nickname_now);
log(`核验目标: ${targets.size} 人 (作品数阈值、活动状态、改名与内容变化)`);

async function readProfile(page, sec, nick) {
  const r = await fetchProfileOther(page, sec, COMMON);
  if (r?.status_code !== 0 || r.sec_uid !== sec) throw new Error('目标身份无法核实');
  return {
    sec_uid: sec,
    nickname: nick,
    status: r.is_punish ? 'banned' : 'normal',
    punish_text: r.punish_text,
    secret: r.secret,
    follow_status: r.follow_status,
    works_fresh: r.works,
  };
}

const m = await launch('main');
try {
  const owner = await selfInfo(m, COMMON);
  if (!isOwner(owner, 'main')) throw new Error('当前账号不符，停止主页核验');
  const progressFile = fileURLToPath(new URL('../data/.profile-progress.json', import.meta.url));
  const saved = readJson(progressFile);
  const records = saved?.owner === owner.sec_uid && saved.exported_at === snap.exported_at ? saved.records || {} : {};
  const sourceKey = (account) => JSON.stringify([
    account.works,
    account.n_visible,
    account.works_checked_at ?? account.times ?? [],
    account.works_checked_at ? null : account.posts?.map((p) => p.id),
  ]);
  for (const [sec, entry] of Object.entries(records)) {
    if (!targets.has(sec) || entry.source !== sourceKey(snap.accounts[sec])) delete records[sec];
  }
  const save = () => writeJson(progressFile, { owner: owner.sec_uid, exported_at: snap.exported_at, total: targets.size, records });
  const out = [];
  let updated = 0, consecErr = 0;
  for (const [sec, nick] of targets) {
    const account = snap.accounts[sec];
    const cached = records[sec];
    const source = sourceKey(account);
    let record = cached?.record;
    let fetched = false;
    if (!record) {
      try {
        record = await readProfile(m.page, sec, nick);
        consecErr = 0;
      } catch {
        if (m.page.isClosed?.()) { save(); throw new Error('采集窗口已关闭，已保存主页核验进度，重新在线更新即可继续'); }
        record = { sec_uid: sec, nickname: nick, status: 'ERR' };
        consecErr++;
      }
      fetched = true;
    }
    const inGallery = (record.works_fresh ?? account.works ?? 0) < 20 || changedIds.has(sec) || staleAtSnapshot(account, asOf, record, previous[sec]);
    let supplement = cached?.posts;
    if (inGallery && record.status === 'normal' && !record.secret && account.n_visible > 0 && !Array.isArray(account.posts)) {
      if (!Array.isArray(supplement)) {
        try { supplement = await readRecentWorks(m.page, sec, COMMON); }
        catch { account.postDetailsUnavailable = true; }
        fetched = true;
        await sleep(3200);
      }
      if (Array.isArray(supplement)) {
        account.posts = supplement;
        delete account.postDetailsUnavailable;
      }
    }
    out.push(record);
    if (record.status !== 'ERR') records[sec] = { record, source, posts: supplement };
    if (consecErr >= 8) {
      save();
      throw new Error('主页核验连续失败过多（可能触发平台验证或登录失效），已保存核验进度，请检查后重试');
    }
    if (fetched) {
      updated++;
      if (updated % 20 === 0) save();
      await sleep(1100 + Math.floor(Math.random() * 500));
    }
    if (out.length % 30 === 0) log('进度 ' + out.length + '/' + targets.size);
  }
  save();
  if (out.some((r) => r.status === 'ERR')) throw new Error('部分处罚状态未核实，已保留原核验结果');
  writeJson('data/snapshot_latest.json', snap);
  writeJson('data/ban_latest.json', out);
  const nb = out.filter((x) => x.status === 'banned').length;
  log(`===== 完成: ${out.length} 人核验, 处罚 ${nb} 人 -> data/ban_latest.json =====`);
} finally {
  await m.context.close().catch(() => {});
}
