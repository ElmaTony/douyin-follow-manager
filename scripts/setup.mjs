import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { launch } from './lib.mjs';
import { selfInfo } from './account-checks.mjs';
import { writeJson } from './core.mjs';
import { binding, dataDir, initialize } from './local-state.mjs';

const role = process.argv[2];
if (!['main','alt'].includes(role)) throw new Error('用法：node scripts/setup.mjs main 或 alt');
initialize();
const label = role === 'main' ? '目标大号' : '来源小号';
const browser = await launch(role);
const terminal = createInterface({input: stdin, output: stdout});
try {
  await browser.page.goto('https://www.douyin.com/', {waitUntil:'domcontentloaded'});
  await terminal.question('请在浏览器中自行登录' + label + '，完成后回到此处按回车。');
  const user = await selfInfo(browser, {aid:'6383',device_platform:'webapp',channel:'channel_pc_web'});
  if (user?.status_code !== 0 || !user.sec_uid || !user.short_id || user.short_id === '0')
    throw new Error('无法确认登录身份，请检查浏览器中的账号后重试。');
  const other = binding(role === 'main' ? 'alt' : 'main');
  if (other?.sec_uid === user.sec_uid) throw new Error('两个角色必须属于不同账号。');
  const current = binding(role);
  if (current && current.sec_uid !== user.sec_uid) throw new Error('此目录已绑定另一账号。请用新的程序目录管理另一组账号。');
  const entered = await terminal.question(label + '：' + user.nickname + '。请输入显示的账号编号 ' + user.short_id + ' 以确认绑定：');
  if (entered.trim() !== user.short_id) throw new Error('编号不符，绑定已取消。');
  writeJson(path.join(dataDir, 'account.' + role + '.json'), {
    short_id: user.short_id,
    sec_uid: user.sec_uid,
    nickname: user.nickname || '',
    douyin_id: user.unique_id || user.short_id,
  });
  console.log(label + '身份已确认。');
} finally { terminal.close(); await browser.context.close(); }
