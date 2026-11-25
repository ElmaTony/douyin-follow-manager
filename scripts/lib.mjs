import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportCsvText, writeJson } from './core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJ = path.resolve(__dirname, '..');
export const DATA = path.join(PROJ, 'data');
export const PROFILES = path.join(PROJ, 'profiles');

// Use a local Chrome installation, or the path explicitly selected by the user.
function resolveChrome() {
  if (process.env.GUANXU_CHROME) return process.env.GUANXU_CHROME;
  const paths = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
    .filter(Boolean).map(base => path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  return paths.find(file => fs.existsSync(file)) || chromium.executablePath();
}
export const CHROME = resolveChrome();

// 账号标识: alt = 小号(源), main = 大号(目标)
export const ACCOUNTS = ['alt', 'main'];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
export const nowStr = () => new Date().toTimeString().slice(0, 8);

export function log(msg) {
  const line = `[${nowStr()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(path.join(DATA, 'run.log'), line + '\n');
  } catch {}
}

/**
 * 启动一个持久化浏览器上下文。
 * userDataDir 落盘 => 登录态跨脚本保留, 彻底绕开 agent-browser 进程被回收的问题。
 */
export async function launch(which, { background = process.env.GUANXU_BACKGROUND === '1' } = {}) {
  if (!ACCOUNTS.includes(which)) throw new Error(`unknown account: ${which}`);
  const userDataDir = path.join(PROFILES, which);
  fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: CHROME,
    headless: background,
    viewport: background ? {width:1440,height:900} : null,
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      ...(background ? [] : ['--start-maximized']),
    ],
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });

  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(30000);
  return { context, page };
}

/** 风控关键词。命中即暂停, 交人工处理。 */
const RISK_PATTERNS = [
  '操作频繁',
  '稍后再试',
  '请稍后',
  '验证',
  '滑块',
  '安全验证',
  '关注失败',
  '请求过于频繁',
  '已触发',
  '限制',
];

export async function detectRisk(page) {
  try {
    const text = await page.evaluate(() => document.body?.innerText || '');
    const hit = RISK_PATTERNS.filter((p) => text.includes(p));
    return { risky: hit.length > 0, hits: hit, snippet: text.replace(/\s+/g, ' ').slice(0, 200) };
  } catch {
    return { risky: false, hits: [], snippet: '' };
  }
}

export async function isLoggedIn(context) {
  const cookies = await context.cookies();
  return cookies.some((c) => c.name === 'sessionid' || c.name === 'sessionid_ss');
}

// ---- 台账 ----
const LEDGER = path.join(DATA, 'ledger.json');

export function loadLedger() {
  const rows = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  if (!Array.isArray(rows)) throw new Error('台账格式错误，已停止写入');
  return rows;
}

export function saveLedger(rows) {
  writeJson(LEDGER, rows, 2);
}

export function toCsv(rows, file) {
  const cols = [
    'idx',
    'nickname',
    'sec_uid',
    'douyin_id',
    'legacy_short_id',
    'uid',
    'profile_url',
    'main_follow',
    'main_follow_time',
    'alt_unfollow',
    'alt_unfollow_time',
    'note',
  ];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, reportCsvText(cols, rows.map((r) => cols.map((c) => r[c]))), 'utf8');
  return file;
}
