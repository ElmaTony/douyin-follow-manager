/**
 * scan_bans_latest — 处罚状态核验(新版)
 *  范围: 作品<20 的账号 ∪ 卖号嫌疑账号
 *  依据: user.punish_remind_info(仅受罚号有) + secret
 *  输出 data/ban_latest.json
 */
import { launch, sleep } from './lib.mjs';
import { selfInfo, isOwner } from './account-checks.mjs';
import { readJson, writeJson } from './core.mjs';

const COMMON = {
  device_platform: 'webapp', aid: '6383', channel: 'channel_pc_web', pc_client_type: '1',
  version_code: '170400', version_name: '17.4.0', cookie_enabled: 'true', platform: 'PC', downlink: '10',
};
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const snap = readJson('data/snapshot_latest.json');
if (!snap) { console.error('缺少 snapshot_latest.json'); process.exit(1); }
const suspects = readJson('data/suspects_latest.json') || [];

const targets = new Map();
for (const [sec, a] of Object.entries(snap.accounts)) {
  if ((a.works || 0) < 20) targets.set(sec, a.nickname);
}
for (const s of suspects) if (!targets.has(s.sec_uid)) targets.set(s.sec_uid, s.nickname_now);
log(`核验目标: ${targets.size} 人 (作品<20 或 卖号嫌疑)`);

const m = await launch('main');
try {
  if (!isOwner(await selfInfo(m, COMMON), 'main')) throw new Error('处罚核验账号不符');
  const out = [];
  let i = 0;
  for (const [sec, nick] of targets) {
    i++;
    let rec = { sec_uid: sec, nickname: nick, status: 'normal', punish_text: '', secret: 0, follow_status: null, works_fresh: null };
    try {
      const r = await m.page.evaluate(async ({ sec, common }) => {
        const qs = new URLSearchParams({ ...common, sec_user_id: sec, source_type: '4', publish_video_strategy_type: '2' });
        const res = await fetch('https://www.douyin.com/aweme/v1/web/user/profile/other/?' + qs, {
          headers: { accept: 'application/json', referer: 'https://www.douyin.com/' }, credentials: 'include',
        });
        const d = await res.json();
        if (d?.status_code !== 0 || d.user?.sec_uid !== sec) throw new Error('目标身份无法核实');
        const x = d.user;
        const p = x.punish_remind_info || null;
        return {
          follow_status: x.follow_status, secret: x.secret || 0, works: x.aweme_count ?? null,
          is_punish: !!(p && (p.is_punish || p.prompt_bar?.content)),
          punish_text: p?.punish_content?.content || p?.prompt_bar?.content || '',
        };
      }, { sec, common: COMMON });
      rec.follow_status = r.follow_status;
      rec.secret = r.secret;
      rec.works_fresh = r.works;
      rec.status = r.is_punish ? 'banned' : 'normal';
      rec.punish_text = r.punish_text;
    } catch (e) { rec.status = 'ERR'; }
    out.push(rec);
    if (i % 30 === 0) { log(`进度 ${i}/${targets.size}`); }
    await sleep(1100 + Math.floor(Math.random() * 500));
  }
  if (out.some(r => r.status === 'ERR')) throw new Error('部分处罚状态未核实，已保留原核验结果');
  writeJson('data/ban_latest.json', out);
  const nb = out.filter((x) => x.status === 'banned').length;
  log(`===== 完成: ${out.length} 人核验, 处罚 ${nb} 人 -> data/ban_latest.json =====`);
} finally {
  await m.context.close();
}
