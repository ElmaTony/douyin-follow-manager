/** 离线回归。命令运行在临时项目中，页面和账号状态均为本地模拟。 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { templateTag } from './gallery.mjs';
import { confirmedStatus } from './account-checks.mjs';
import { galleryPayload, normalizeFileUrl, snapshotTime, staleAtSnapshot } from './core.mjs';
import { maxFollowingPages } from './douyin-api.mjs';

const sources = fileURLToPath(new URL('.', import.meta.url));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-offline-'));
const data = path.join(fixture, 'data');
fs.mkdirSync(data);
fs.mkdirSync(path.join(fixture,'scripts'));
for (const name of ['local-state.mjs','account-checks.mjs','core.mjs','douyin-api.mjs','driver2.mjs','finalize.mjs','doctor.mjs','setup.mjs','rebuild_latest.mjs','unfollow_list.mjs','compare_snapshots.mjs','transfer.mjs','batch_unfollow.mjs','unfollow-action.mjs','final_verify.mjs','merge_incremental.mjs','read_suspect_state.mjs','prep_suspect_unfollow.mjs','sync_marks.mjs','preflight_incremental.mjs','update_registry.mjs','run.mjs','open_review_env.mjs','profile-tab.mjs','gallery-unfollow.mjs','gallery-queue.js','refresh_review.mjs',
  'snapshot_main.mjs','recent-works.mjs','topic-change.mjs','scan_bans_latest.mjs','build_suspects_latest.mjs','gallery.mjs','gallery.css','gallery-client.js','gallery-profiles.js', 'gallery-decisions.js',
  'gallery-lightbox.js','gen_review_gallery.mjs','gen_stale_gallery.mjs','gen_suspect_gallery.mjs']) {
  fs.copyFileSync(path.join(sources,name),path.join(fixture,'scripts',name));
}
// The browser double executes the actual page callbacks. An unexpected click fails the test.
fs.writeFileSync(path.join(fixture,'scripts/lib.mjs'), `
import fs from 'node:fs';
import path from 'node:path';
import { reportCsvText } from './core.mjs';
const scene = JSON.parse(process.env.QA_SCENE);
const seqIndex = { main: 0, alt: 0 };
let otherCalls = 0;
export const PROJ = process.cwd(), CHROME = process.execPath, DATA = 'data', sleep = async () => {}, randInt = () => 0, log = console.log;
export const loadLedger = () => JSON.parse(fs.readFileSync('data/ledger.json'));
export const saveLedger = rows => fs.writeFileSync('data/ledger.json',JSON.stringify(rows));
export function toCsv(rows, file) {
  const cols = ['idx','nickname','sec_uid','douyin_id','legacy_short_id','uid','profile_url','main_follow','main_follow_time','alt_unfollow','alt_unfollow_time','note'];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, reportCsvText(cols, rows.map(r => cols.map(c => r[c]))), 'utf8');
  return file;
}
export async function launch(which) {
  const owner = [which + '-id',which + '-test-identity'];
  if (scene.review) {
    let closed;
    const page = {
      goto: async url=>fs.appendFileSync('review-urls',JSON.stringify(url)+'\\n'),
      bringToFront: async ()=>closed(),
    };
    return {page,context:{exposeBinding:async()=>{},once:(_event,listener)=>{closed=listener;},close:async()=>{},newPage:async()=>page}};
  }
  let address = '';
  const emptyLoc = { count: async () => 0, all: async () => [], filter: () => emptyLoc, getByRole: () => emptyLoc, or: (o) => o };
  return {context:{close:async()=>{}},page:{
    goto:async url=>{address=url;},
    locator:(sel)=>{
      if (String(sel).includes('user-info-follow-btn')) {
        const makeBtn = (ok) => ({
          count: async () => (ok ? 1 : 0),
          filter: ({ hasText } = {}) => makeBtn(ok && (!hasText || hasText.test(scene.buttonText || '互相关注'))),
          first: () => ({
            click: async () => {
              if (!scene.allowClick) { fs.appendFileSync('click-attempt','x'); throw Error('Unexpected button access'); }
              fs.appendFileSync('clicks', which + ' ' + new URL(address).pathname.split('/').pop() + '\\n');
            }
          })
        });
        return makeBtn(true);
      }
      return emptyLoc;
    },
    getByRole:()=>emptyLoc,
    evaluate:async (fn,arg)=>{
      const target = new URL(address).pathname.split('/').pop();
      if (address.startsWith('file:')) {
        const stores = JSON.parse(fs.readFileSync('data/marks.json'));
        globalThis.localStorage = {
          getItem: key => stores[target]?.[key] ?? null,
          setItem: (key, value) => { stores[target][key] = value; fs.writeFileSync('data/marks.json', JSON.stringify(stores)); }
        };
        return fn(arg);
      }
      globalThis.location = {pathname: scene.path || new URL(address).pathname};
      globalThis.document = {
        title: scene.docTitle ?? '测试',
        body:{innerText: scene.bodyText || '抖音号：abc'},
        querySelector: () => (scene.allowClick ? { textContent: scene.buttonText || (which === 'main' ? '关注' : '互相关注') } : null),
        querySelectorAll:(sel)=>{
          if (!scene.allowClick) {
            fs.appendFileSync('click-attempt','x');throw Error('Unexpected button access');
          }
          if (String(sel).includes('user-info-follow-btn')) {
            return [{
              textContent: scene.buttonText || (which === 'main' ? '关注' : '互相关注'),
              getBoundingClientRect: () => ({ width: 80, height: 32 }),
              click: () => fs.appendFileSync('clicks', which + ' ' + target + '\\n'),
            }];
          }
          return [];
        }
      };
      globalThis.fetch = async url => ({text:async()=>JSON.stringify(scene.posts),json:async()=>{
        if (url.includes('/self/')) return {status_code:0,user:{following_count:scene.count ?? 1,short_id:scene.wrongOwner?'0':owner[0],sec_uid:owner[1]+'-fixture'}};
        if (url.includes('/following/list/')) return scene.listResponse;
        const readId = target || new URL(url).searchParams.get('sec_user_id') || '';
        fs.appendFileSync('reads', which + ' ' + readId + '\\n');
        otherCalls++;
        if (scene.failAfter != null && otherCalls > scene.failAfter) return {status_code:1};
        const raw = scene[which];
        const status = Array.isArray(raw) ? raw[Math.min(seqIndex[which]++, raw.length - 1)] : raw;
        return {status_code:0,user:{sec_uid:new URL(url).searchParams.get('sec_user_id'),follow_status:status,nickname:scene.targetNickname ?? '测试',unique_id:scene.targetId ?? 'abc'}};
      }});
      return fn(arg);
    }
  }};
}`);
const write = (file, value) => fs.writeFileSync(path.join(data,file),typeof value==='string'?value:JSON.stringify(value));
const read = file => fs.readFileSync(path.join(data,file),'utf8');
const sec = 'same-prefix-1234567890-account';
const record = {idx:1,sec_uid:sec,douyin_id:'abc',nickname:'测试',main_follow:'',alt_unfollow:''};
function reset() {
  for (const file of ['click-attempt','reads','clicks']) fs.rmSync(path.join(fixture,file),{force:true});
  for (const file of ['.profile-progress.json','.snapshot-progress.json','snapshot_latest.json','snapshot_previous.json','suspects_latest.json']) fs.rmSync(path.join(data,file),{force:true});
  for (const role of ['main','alt']) write('account.'+role+'.json',{short_id:role+'-id',sec_uid:role+'-test-identity-fixture'});
  write('ledger.json',[record]); write('user_keep_list.json',{keeps:[]});
  write('unfollow_registry.json',{entries:{}}); write('ban_latest.json',[]);
}
function run(script,scene,args=[]) {
  return spawnSync(process.execPath,['scripts/'+script+'.mjs',...args],{
    cwd:fixture,env:{...process.env,QA_SCENE:JSON.stringify(scene)},encoding:'utf8',timeout:5000
  });
}
function untouched() {assert.ok(!fs.existsSync(path.join(fixture,'click-attempt')));}
after(() => {
  assert.equal(path.dirname(fixture), path.resolve(os.tmpdir()));
  assert.ok(path.basename(fixture).startsWith('douyin-offline-'));
  fs.rmSync(fixture, {recursive:true, force:true});
});
test('停更以快照时间为准，包括 30、90、180 天边界', () => {
  const asOf=snapshotTime({exported_at:'2026-10-19T15:05:57Z'});
  for(const [days,group] of [[30,null],[31,'s3090'],[90,'s3090'],[91,'s90180'],[180,'s90180'],[181,'s180']]){
    assert.equal(staleAtSnapshot({times:[asOf-days*86400]},asOf)?.group??null,group);
  }
  assert.equal(staleAtSnapshot({times:[]},asOf),null);
  assert.throws(()=>snapshotTime({}));
});
test('只有目标账号的明确 0、1 或 2（互相关注）可作为关注状态', () => {
  for(const follow_status of [0,1,2]) assert.equal(confirmedStatus({status_code:0,sec_uid:sec,follow_status},sec),follow_status);
  for(const response of [
    null,{},
    {status_code:1,sec_uid:sec,follow_status:1},
    {status_code:0,sec_uid:'other',follow_status:1},
    {status_code:0,sec_uid:sec,follow_status:3},
    {status_code:0,sec_uid:sec,follow_status:-1},
  ])
    assert.throws(()=>confirmedStatus(response,sec));
});
test('大号状态未知，即使台账上次为已关注，也中止小号操作', () => {
  reset(); write('ledger.json',[{...record,main_follow:'already'}]);
  const before=read('ledger.json');
  const result=run('transfer',{});
  assert.equal(result.status,1); assert.match(result.stderr,/无法确认目标账号/);
  assert.equal(read('ledger.json'),before); assert.ok(!fs.readFileSync(path.join(fixture,'reads'),'utf8').includes('alt ')); untouched();
});
test('登录角色错误或目标主页仅前缀相同，均不操作', () => {
  reset(); assert.equal(run('transfer',{wrongOwner:true}).status,2); untouched();
  const wrong=run('transfer',{path:'/user/'+sec.slice(0,20)+'-other'});
  assert.match(wrong.stdout,/身份核对失败/); untouched();
});
test('已取关登记和永久保留都能拦截重新关注，且不阻塞同批后续正常账号', () => {
  for(const keep of [true,false]){
    reset();
    const normalRow = {idx:2,sec_uid:'normal-next',douyin_id:'abc',nickname:'测试',main_follow:'',alt_unfollow:''};
    write('ledger.json',[record,normalRow]);
    if(keep)write('user_keep_list.json',{keeps:[record]});
    else write('unfollow_registry.json',{entries:{[sec]:{}}});
    const result=run('transfer',{allowClick:true,main:[0,0,1],alt:[1,0]});
    assert.equal(result.status,0,result.stderr); assert.match(result.stderr,/已停止重新关注/);
    const clicks=read('../clicks');
    assert.doesNotMatch(clicks,new RegExp(sec));
    assert.match(clicks,/main normal-next/);
    assert.match(clicks,/alt normal-next/);
    const after=JSON.parse(read('ledger.json'));
    assert.equal(after[0].main_follow,'skip_protected');
    assert.equal(after[1].main_follow,'done');
    assert.equal(after[1].alt_unfollow,'done');
  }
});
test('批量干跑遵守数量上限，保护名单先排除，保留执行报告和断点', () => {
  reset(); write('user_keep_list.json',{keeps:[{sec_uid:'protected'}]});
  write('ban_latest.json',[{sec_uid:'banned',status:'banned'}]);
  write('input.csv','昵称,抖音号,sec_uid\n'+['protected','banned',sec,'other'].map(s=>'测试,abc,'+s).join('\n'));
  write('unfollow_state.json','{"done":{},"skipped":{},"failed":{}}');
  write('unfollow_report.csv','old');
  for (const args of [['--limit','1'],['--limit=1']]){
    const result=run('batch_unfollow',{main:0},['--list','data/input.csv',...args]);
    assert.equal(result.status,0,result.stderr); assert.match(result.stdout,/待处理 1 条/);
    const report=read('unfollow_dry_report.csv'); assert.ok(report.includes(sec)); assert.doesNotMatch(report,/protected|banned|other/);
    assert.equal(read('unfollow_report.csv'),'old'); assert.equal(read('unfollow_state.json'),'{"done":{},"skipped":{},"failed":{}}'); untouched();
  }
  assert.notEqual(run('batch_unfollow',{},['--list','data/input.csv','--limit','invalid']).status,0);
});
test('终验遇到无效响应时保留上次完整结果', () => {
  reset(); write('verify.json','old');
  const result=run('final_verify',{main:1});
  assert.equal(result.status,1); assert.equal(read('verify.json'),'old'); untouched();
  const good=run('final_verify',{main:1,alt:0});
  assert.equal(good.status,0,good.stderr); assert.equal(JSON.parse(read('verify.json')).rows[0].alt_status,0); untouched();
});
test('同一导出中的重复账号只合并一次，空台账从 1 编号', () => {
  reset(); write('ledger.json',[]); write('in.json',{list:[record,record]});
  const result=run('merge_incremental',{},['data/in.json']);
  assert.equal(result.status,0,result.stderr);const rows=JSON.parse(read('ledger.json'));
  assert.equal(rows.length,1);assert.equal(rows[0].idx,1);
});

test('导出分页中断时不替换上次完整的小号快照', () => {
  reset(); write('export.json','old');
  const result = run('preflight_incremental',{listResponse:{status_code:1}},['data/export.json']);
  assert.equal(result.status,1); assert.equal(read('export.json'),'old');
});
test('跨画廊同步读取各自页面的标记，导出排除过期和保留账号', () => {
  const rows = ['first','second','locked','removed'].map(sec_uid => ({
    sec_uid, nickname:sec_uid, douyin_id:'abc', tier:'high'
  }));
  const html = (key,data) => '<script type="application/json" id="gallery-data">'+
    JSON.stringify({data, key, protectedIds:['locked']})+'</script>';
  write('suspect_gallery.html',html('suspect_state_v1',rows.slice(0,3)));
  write('review_gallery.html',html('review_state_v2',rows));
  write('marks.json',{
    'suspect_gallery.html':{suspect_state_v1:JSON.stringify({first:'unf',second:'unf',locked:'unf',removed:'unf'})},
    'review_gallery.html':{review_state_v2:JSON.stringify({first:'keep'})}
  });
  const synced=run('sync_marks',{});
  assert.equal(synced.status,0,synced.stderr);
  const stores=JSON.parse(read('marks.json'));
  assert.deepEqual(JSON.parse(stores['review_gallery.html'].review_state_v2),{first:'keep',second:'unf'});
  const readback=run('read_suspect_state',{});
  assert.equal(readback.status,0,readback.stderr);
  const marks=JSON.parse(read('suspect_state_read.json'));
  assert.deepEqual(marks.raw,{first:'unf',second:'unf'});
  marks.raw.locked='unf'; marks.raw.removed='unf'; write('suspect_state_read.json',marks);
  const prep=run('prep_suspect_unfollow',{});
  assert.equal(prep.status,0,prep.stderr);
  const csv=read('batch_unfollow_suspects.csv');
  assert.match(csv,/first/); assert.match(csv,/second/); assert.doesNotMatch(csv,/locked|removed/);
});

test('GUI 接收四列决定名单，未标、保留、重复和受保护账号均不进入待执行清单',()=>{
  reset(); write('user_keep_list.json',{keeps:[{sec_uid:'protected'}]});
  write('名单 & (复测).txt',[
    'person-a\t选中A\t123\t取关', 'person-a\t选中A\t123\t取关',
    'person-b\t不应出现B\t234\t未审','person-c\t不应出现C\t345\t保留','person-x\t不应出现X\t999\t待复核',
    'protected\t不应出现D\t456\t取关','person-e\t不应出现E\t567\t取关','person-e\t不应出现E\t567\t保留',
  ].join('\n'));
  const preview=run('run',{},['preview','data/名单 & (复测).txt']);
  assert.equal(preview.status,0,preview.stderr); assert.match(preview.stdout,/待处理 1 条/);
  assert.match(preview.stdout,/选中A/);assert.doesNotMatch(preview.stdout,/不应出现/);untouched();
  write('invalid.csv','备注,名字\nfoo,bar');
  assert.notEqual(run('run',{},['preview','data/invalid.csv']).status,0);
});
test('错误账号和缺页不能改写取关登记表，完整列表按采集日更新',()=>{
  reset(); const original=read('unfollow_registry.json');
  write('main_following_2020-01-02.json',[{sec_uid:'former',nickname:'历史',douyin_id:'old'}]);
  for(const scene of [
    {wrongOwner:true},
    {count:2,listResponse:{status_code:0,has_more:0,followings:[{sec_uid:'current'}]}},
    {count:1,listResponse:{status_code:0,has_more:1,followings:[]}},
  ]){
    const bad=run('update_registry',scene);
    assert.notEqual(bad.status,0);assert.equal(read('unfollow_registry.json'),original);
  }
  const history=read('main_following_2020-01-02.json');
  const good=run('update_registry',{count:1,listResponse:{status_code:0,has_more:0,followings:[{sec_uid:'current',nickname:'测试'}]}});
  assert.equal(good.status,0,good.stderr);assert.equal(read('main_following_2020-01-02.json'),history);
  const registry=JSON.parse(read('unfollow_registry.json'));
  assert.equal(registry.entries.former.last_seen,'2020-01-02'); assert.ok(!registry.entries.current);
});
test('接口提前报告末页时，迁移前置核对仍须比对来源账号总数',()=>{
  reset();write('export.json','old');
  const result=run('preflight_incremental',{count:2,listResponse:{status_code:0,has_more:0,followings:[{sec_uid:'one'}]}},['data/export.json']);
  assert.equal(result.status,1); assert.equal(read('export.json'),'old');
});

test('指定画廊只打开其本地地址，关闭后顺利结束；缺失画廊会报错',()=>{
  reset();
  write('snapshot_latest.json',{exported_at:'2025-05-01T12:00:00Z',accounts:{}});
  for (const name of ['review','suspect']) write(name+'_gallery.html',templateTag);
  write('stale_gallery.html','<button id="openQueue"></button>');
  const opened=run('run',{review:true},['open','stale']);
  assert.equal(opened.status,0,opened.stderr);
  assert.ok(read('stale_gallery.html').includes(templateTag),'已带取关入口的旧画廊也需要升级');
  const urls=fs.readFileSync(path.join(fixture,'review-urls'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(urls.length,1); assert.match(urls[0],/^file:.*stale_gallery\.html$/);
  fs.rmSync(path.join(data,'stale_gallery.html'));
  const missing=run('run',{review:true},['open','stale']);
  assert.notEqual(missing.status,0);assert.match(missing.stderr,/画廊文件缺失/);
});

test('在线更新各阶段都成功才发布；采集失败保留原六个文件；中断发布可恢复',()=>{
  reset();
  const files=['snapshot_latest.json','suspects_latest.json','ban_latest.json','review_gallery.html','stale_gallery.html','suspect_gallery.html'];
  for(const f of files) write(f,'original');
  const scene={count:1,main:1,listResponse:{status_code:0,has_more:0,followings:[{sec_uid:'user',nickname:'测试',unique_id:'abc',aweme_count:1}]}};
  const bad=run('run',{...scene,posts:{status_code:1}},['refresh']);
  assert.notEqual(bad.status,0); for(const f of files) assert.equal(read(f),'original');
  const good=run('run',{...scene,posts:{status_code:0,aweme_list:[]}},['refresh']);
  assert.equal(good.status,0,good.stderr);
  assert.equal(JSON.parse(read('snapshot_latest.json')).accounts.user.fetch,'ok');
  for(const f of files.slice(3)) assert.ok(read(f).includes('gallery-data'));
  const ready=path.join(data,'.review-ready');fs.mkdirSync(ready);
  const manifest={};
  for(const [i,f] of files.entries()) {
    const value=read(f); manifest[f]=createHash('sha256').update(value).digest('hex');
    if(i>=3) {fs.writeFileSync(path.join(ready,f),value);write(f,'previous');}
  }
  fs.writeFileSync(path.join(ready,'manifest.json'),JSON.stringify(manifest));
  assert.notEqual(run('run',{},['gallery','all']).status,0);
  const tail=files.at(-1), tailPath=path.join(ready,tail);
  const intact=fs.readFileSync(tailPath);
  fs.writeFileSync(tailPath,'corrupt');
  assert.notEqual(run('run',{},['refresh']).status,0);
  for (const f of files.slice(3)) assert.equal(read(f),'previous','校验失败不应替换任何画廊');
  fs.writeFileSync(tailPath,intact);
  const recovered=run('run',{wrongOwner:true},['refresh']);
  assert.equal(recovered.status,0,recovered.stderr);assert.ok(!fs.existsSync(ready));
  for(const f of files) assert.equal(createHash('sha256').update(read(f)).digest('hex'),manifest[f]);
});

test('账号绑定要求完整身份且来源与目标不同', () => {
  reset();
  for (const file of ['account.main.json','account.alt.json']) fs.rmSync(path.join(data,file));
  assert.equal(run('transfer',{}).status,2); untouched();
  write('account.main.json',{short_id:'main-id',sec_uid:'main-test-identity'});
  assert.equal(run('transfer',{}).status,2); untouched();
  for (const role of ['main','alt']) write('account.'+role+'.json',{short_id:'main-id',sec_uid:'main-test-identity-fixture'});
  assert.equal(run('transfer',{}).status,2); untouched();
});

test('内容变化比较使用自己的前后两次快照', () => {
  const original = {nickname:'示例旧名', captions:['绘画 水彩','素描练习'], covers:[]};
  const latest = {nickname:'示例新名', captions:['烘焙 食材','周末菜谱'], covers:[]};
  write('snapshot_latest.json',{accounts:{sample:latest}});
  write('snapshot_previous.json',{accounts:{sample:original}});
  assert.equal(run('build_suspects_latest',{}).status,0);
  const [change] = JSON.parse(read('suspects_latest.json'));
  assert.equal(change.tier,'high'); assert.equal(change.nickname_first,original.nickname);
  write('snapshot_previous.json',{});
  assert.equal(run('build_suspects_latest',{}).status,0);
  assert.deepEqual(JSON.parse(read('suspects_latest.json')),[]);
});

test('快照对比按稳定标识匹配，区分新增、移出与改名，重复时间不覆盖报告', () => {
  const row = {nickname:'旧名', douyin_id:'demo', works:3, followers:5, times:[]};
  write('snapshot_previous.json',{exported_at:'2024-01-01T00:00:00Z',accounts:{one:row,removed:row}});
  const newest={exported_at:'2024-02-01T00:00:00Z',accounts:{one:{...row,nickname:'=example',works:5},added:row}};
  write('snapshot_latest.json',newest);
  const result=run('compare_snapshots',{});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/新增 1.*移出 1.*改名 1.*作品数变化 1/);
  const report=read('snapshot_changes.csv'); assert.ok(report.includes("'=example"));
  write('snapshot_previous.json',newest);
  assert.notEqual(run('compare_snapshots',{}).status,0);
  assert.equal(read('snapshot_changes.csv'),report);
});

test('停更以满天计；置顶乱序取最新，私密或有作品但无日期单独待核', () => {
  const now = 1800000000;
  assert.equal(staleAtSnapshot({times:[now-120*86400,now-30.9*86400]},now),null);
  assert.equal(staleAtSnapshot({times:[],works:4},now).group,'unknown');
  assert.equal(staleAtSnapshot({times:[],works:0},now),null);
  assert.equal(staleAtSnapshot({times:[now-100*86400],posts:[{time:now}]},now),null);
  assert.equal(staleAtSnapshot({times:[now],posts:[],works:4},now).group,'unknown');
  const localMidnight=new Date(2024,0,2,0,30);
  const oldWorks=staleAtSnapshot({times:[localMidnight.getTime()/1000]},localMidnight.getTime()/1000+95*86400);
  assert.equal(oldWorks.dateStr,'2024-01-02');
  const prior={times:[now-50*86400]};
  assert.equal(staleAtSnapshot({times:[],works:4},now,{}, {times:[now-20*86400]}),null);
  const corrected=staleAtSnapshot({times:[now-200*86400]},now,{},prior);
  assert.equal(corrected.group,'s3090'); assert.equal(corrected.fromHistory,true);
  assert.equal(staleAtSnapshot({times:[],works:4},now,{},prior).group,'unknown');
  assert.equal(staleAtSnapshot({times:[now-200*86400]},now,{secret:1}).group,'unknown');
});

test('每条作品在排序后仍与同一作者的封面、文案及原作 ID 对应', async () => {
  const {readRecentWorks}=await import('./recent-works.mjs');
  const raw=[{aweme_id:'11',create_time:10,desc:'较早',video:{cover:{url_list:['https://example.invalid/old']}}},
    {aweme_id:'22',create_time:20,desc:'没有封面'},
    {aweme_id:'33',create_time:30,images:[{url_list:['https://example.invalid/new']}]}
  ];
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>({text:async()=>JSON.stringify({status_code:0,aweme_list:raw})});
    const p={evaluate:(fn,arg)=>fn(arg)};
    const rows=await readRecentWorks(p,'demo',{});
    assert.deepEqual(rows.map(x=>[x.id,x.caption,x.cover,x.type]),[
      ['33','','https://example.invalid/new','note'],['22','没有封面','','video'],['11','较早','https://example.invalid/old','video']]);
    raw[0].author={sec_uid:'other'};
    await assert.rejects(readRecentWorks(p,'demo',{}),/作者不符/);
  } finally {globalThis.fetch=original;}
});

test('主题变化须有两条不同的新旧文案，重复、并列和共有作品不能单独构成依据', async () => {
  const {topicChange} = await import('./topic-change.mjs');
  const old=['旅行一','旅行二'], now=['烹饪一','美食二'];
  assert.equal(topicChange(old,now).label,'旅行 → 美食');
  assert.equal(topicChange(old,['新品甲同款下单折扣','新品乙同款团购促销']),null);
  assert.equal(topicChange(old,['商品选品教程','电商运营案例']).label,'旅行 → 电商');
  assert.equal(topicChange([old[0],old[0]],now),null);
  assert.equal(topicChange([...old,...now],now),null);
  assert.equal(topicChange([...old,...now,'旅行三'],[...now,'美食三']),null);
});

test('恢复采集时核对账号和完整关注名单，只采未完成的作品', () => {
  reset();
  const list = ['finished','missing'].map(sec_uid=>({sec_uid,nickname:'测试',aweme_count:1}));
  const scene = {count:2,main:1,listResponse:{status_code:0,has_more:0,followings:list}};
  const bad = run('snapshot_main',{...scene,posts:{status_code:1}});
  assert.notEqual(bad.status,0);
  const progress = JSON.parse(read('.snapshot-progress.json'));
  assert.ok(progress.owner);
  Object.assign(progress.accounts.finished,{fetch:'ok',posts:[{id:'111'}],times:[123],n_visible:1});
  write('.snapshot-progress.json',progress);
  const valid = {...scene,posts:{status_code:0,aweme_list:[{aweme_id:'222'}]}};
  const resumed = run('snapshot_main',valid);
  assert.equal(resumed.status,0,resumed.stderr);
  const next = JSON.parse(read('snapshot_latest.json'));
  assert.equal(next.accounts.finished.posts[0].id,'111');
  assert.equal(next.accounts.missing.posts[0].id,'222');
  write('snapshot_latest.json',{});
  write('.snapshot-progress.json',progress);
  const changedList = { ...valid,listResponse:{...valid.listResponse,followings:[list[0],{...list[1],sec_uid:'just-added'}]} };
  const whenMembershipChanges = run('snapshot_main',changedList);
  assert.equal(whenMembershipChanges.status,0,whenMembershipChanges.stderr);
  const joined = JSON.parse(read('snapshot_latest.json')).accounts;
  assert.equal(joined.finished.posts[0].id,'111'); assert.ok(!joined.missing);
  assert.equal(joined['just-added'].posts[0].id,'222');
  write('snapshot_latest.json',{});
  write('.snapshot-progress.json',{...progress,owner:'different-fixture-owner'});
  const fresh = run('snapshot_main',valid);
  assert.equal(fresh.status,0,fresh.stderr);
  assert.equal(JSON.parse(read('snapshot_latest.json')).accounts.finished.posts[0].id,'222');
});

test('同一轮续采刷新作品时，旧主页核验与旧作品不会覆盖当前记录',()=>{
  reset();
  const when=new Date().toISOString();
  const sample=(works,id)=>({exported_at:when,accounts:{sample:{sec_uid:'sample',nickname:'示例',works,n_visible:1,posts:[{id}],times:[]}}});
  write('suspects_latest.json',[]);write('snapshot_latest.json',sample(1,'101'));
  const first=run('scan_bans_latest',{main:1}); assert.equal(first.status,0,first.stderr);
  write('snapshot_latest.json',sample(4,'102'));
  const next=run('scan_bans_latest',{main:0}); assert.equal(next.status,0,next.stderr);
  assert.equal(JSON.parse(read('snapshot_latest.json')).accounts.sample.posts[0].id,'102');
  assert.equal(JSON.parse(read('ban_latest.json'))[0].follow_status,0);
  const reads=fs.readFileSync(path.join(fixture,'reads'),'utf8');
  const unchanged=run('scan_bans_latest',{main:1}); assert.equal(unchanged.status,0,unchanged.stderr);
  assert.equal(fs.readFileSync(path.join(fixture,'reads'),'utf8'),reads);
});

test('旧版快照首次补图失败后，可单独重试作品且沿用成功的主页核验',()=>{
  reset();
  write('suspects_latest.json',[]);
  write('snapshot_latest.json',{exported_at:new Date().toISOString(),accounts:{
    retry:{sec_uid:'retry',nickname:'测试',works:2,n_visible:1,times:[1700000000]}}});
  const first=run('scan_bans_latest',{main:1,posts:{status_code:1}});
  assert.equal(first.status,0,first.stderr);
  assert.equal(JSON.parse(read('snapshot_latest.json')).accounts.retry.postDetailsUnavailable,true);
  const reads=fs.readFileSync(path.join(fixture,'reads'),'utf8');
  const next=run('scan_bans_latest',{main:1,posts:{status_code:0,aweme_list:[{aweme_id:'201',create_time:1700000000}]}});
  assert.equal(next.status,0,next.stderr);
  const account=JSON.parse(read('snapshot_latest.json')).accounts.retry;
  assert.equal(account.posts[0].id,'201');
  assert.ok(!account.postDetailsUnavailable);
  assert.equal(fs.readFileSync(path.join(fixture,'reads'),'utf8'),reads);
});

test('跨画廊独立判定低作品、停更和改名，对同一作者统一待核与导出资格',()=>{
  reset();
  const current='2026-06-01T09:00:00Z', previous='2026-04-01T09:00:00Z';
  const stamp=Date.parse(current)/1000;
  const make=(sec,nickname,works,days)=>({sec_uid:sec,nickname,douyin_id:'demo_'+sec,works,
    times:days?[stamp-days*86400]:[],captions:[],covers:[],followers:1});
  const accounts={
    triple:make('triple','同名示例',12,62), borderline:make('borderline','同名示例',19,31),
    hidden:make('hidden','新名称',3,0), format:make('format','AB',80,10),
    unverified:make('unverified','本周名称',30,90)
  };
  const old=Object.fromEntries(Object.entries(accounts).map(([sec,a])=>[sec,{...a}]));
  old.triple.nickname='旧名甲'; old.hidden.nickname='旧名乙'; old.format.nickname='ＡＢ ';
  old.unverified.nickname='之前名称';
  write('snapshot_previous.json',{exported_at:previous,accounts:old});
  write('snapshot_latest.json',{exported_at:current,accounts});
  write('ledger.json',[{sec_uid:'borderline',nickname:'历史名称'},{sec_uid:'borderline',nickname:'同名示例'}]);
  write('ban_latest.json',Object.values(accounts).filter(a=>a.sec_uid!=='unverified').map(a=>({
    sec_uid:a.sec_uid,status:'normal',works_fresh:a.sec_uid==='borderline'?20:a.works,secret:a.sec_uid==='hidden'?1:0
  })));
  const built=run('run',{},['gallery','all']); assert.equal(built.status,0,built.stderr);
  const payloads=['review','stale','suspect'].map(name=>galleryPayload(read(name+'_gallery.html')));
  const rows=sec=>payloads.map(cfg=>cfg.data.find(row=>row.sec_uid===sec));
  assert.ok(rows('triple').every(row=>row && row.alsoIn.length===2 && !row.badgeFix));
  const [low,stale,rename]=rows('borderline');
  assert.ok(!low && stale.group==='s3090' && rename.renamed && !rename.recentRename);
  assert.ok(stale.alsoIn[0].note.includes('历史名称不同'));
  assert.ok(rows('hidden').every(row=>row.badgeFix));
  assert.ok(rows('unverified').filter(Boolean).every(row=>row.badgeFix==='主页状态待核'));
  assert.ok(!rows('format')[2]);
  for(const cfg of payloads) assert.deepEqual(cfg.union.map(a=>a.sec_uid).sort(),['borderline','triple']);
});

test('互相关注（follow_status=2）全链路支持迁移、终验、汇总与批量取关', () => {
  reset();
  const moved = run('transfer', { allowClick: true, main: [0, 2], alt: [2, 0] });
  assert.equal(moved.status, 0, moved.stderr);
  assert.deepEqual(
    (({ main_follow, alt_unfollow }) => ({ main_follow, alt_unfollow }))(JSON.parse(read('ledger.json'))[0]),
    { main_follow: 'done', alt_unfollow: 'done' }
  );

  reset();
  const already = run('transfer', { allowClick: true, main: [2], alt: [2, 0] });
  assert.equal(already.status, 0, already.stderr);
  assert.deepEqual(
    (({ main_follow, alt_unfollow }) => ({ main_follow, alt_unfollow }))(JSON.parse(read('ledger.json'))[0]),
    { main_follow: 'already', alt_unfollow: 'done' }
  );

  const verified = run('final_verify', { main: 2, alt: 0 });
  assert.equal(verified.status, 0, verified.stderr);
  const v = JSON.parse(read('verify.json'));
  assert.equal(v.rows[0].main_status, 2);
  assert.equal(v.rows[0].alt_status, 0);
  assert.match(verified.stdout, /已转移 1/);

  const finalized = run('finalize', {});
  assert.equal(finalized.status, 0, finalized.stderr);
  assert.match(read('crosscheck.csv'), /✓ 已转移/);

  reset();
  write('mutual.csv', `昵称,抖音号,sec_uid\n测试,abc,${sec}`);
  const dry = run('batch_unfollow', { main: 2 }, ['--list', 'data/mutual.csv']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(read('unfollow_dry_report.csv'), /待取关\(dry-run\)/);
  untouched();

  const exec = run('batch_unfollow', { allowClick: true, buttonText: '互相关注', main: [2, 0] }, ['--list', 'data/mutual.csv', '--execute']);
  assert.equal(exec.status, 0, exec.stderr);
  assert.match(read('unfollow_report.csv'), /取关成功/);
  assert.ok(JSON.parse(read('unfollow_state.json')).done[sec]);
  assert.ok(JSON.parse(read('unfollow_registry.json')).entries[sec]);
});

test('大关注量动态分页上限随总数扩展，突破 3000 人限制', () => {
  assert.ok(maxFollowingPages(4500) > 250);
  assert.ok(maxFollowingPages(6000) > maxFollowingPages(4500));
});

test('台账挂起项不阻塞 driver2 后续记录，且 reset-held 准确复位可重试异常项', () => {
  reset();
  const rows = [
    { idx: 1, sec_uid: 'held-id', douyin_id: 'd1', nickname: '身份异常', main_follow: 'id_check_fail', alt_unfollow: '', fail_count: 3 },
    { idx: 2, sec_uid: 'held-unk', douyin_id: 'd2', nickname: '待复核', main_follow: 'skip_unknown', alt_unfollow: '', fail_count: 5 },
    { idx: 3, sec_uid: 'held-prot', douyin_id: 'd3', nickname: '受保护', main_follow: 'skip_protected', alt_unfollow: '' },
    { idx: 4, sec_uid: 'done-nf', douyin_id: 'd4', nickname: '原未关注', main_follow: 'already', alt_unfollow: 'skip_not_following' },
    { idx: 5, sec_uid: 'done-ok', douyin_id: 'd5', nickname: '已完成', main_follow: 'done', alt_unfollow: 'done' },
    { idx: 6, sec_uid: 'held-rest', douyin_id: 'd6', nickname: '受限保留', main_follow: 'skip_restricted', alt_unfollow: '' },
    { idx: 7, sec_uid: sec, douyin_id: 'abc', nickname: '测试', main_follow: '', alt_unfollow: '' },
  ];
  write('ledger.json', rows);
  const driven = run('driver2', { allowClick: true, main: [0, 1], alt: [1, 0] });
  assert.equal(driven.status, 0, driven.stderr);
  const afterDrive = JSON.parse(read('ledger.json'));
  assert.equal(afterDrive.find(r => r.idx === 7).alt_unfollow, 'done');
  assert.equal(afterDrive.find(r => r.idx === 1).main_follow, 'id_check_fail');

  const resetRes = run('run', {}, ['reset-held']);
  assert.equal(resetRes.status, 0, resetRes.stderr);
  assert.match(resetRes.stdout, /已重置 2 条/);
  const afterReset = JSON.parse(read('ledger.json'));
  assert.equal(afterReset.find(r => r.idx === 1).main_follow, '');
  assert.equal(afterReset.find(r => r.idx === 1).fail_count, 0);
  assert.equal(afterReset.find(r => r.idx === 2).main_follow, '');
  assert.equal(afterReset.find(r => r.idx === 3).main_follow, 'skip_protected');
  assert.equal(afterReset.find(r => r.idx === 4).main_follow, 'already');
  assert.equal(afterReset.find(r => r.idx === 4).alt_unfollow, 'skip_not_following');
  assert.equal(afterReset.find(r => r.idx === 5).alt_unfollow, 'done');
  assert.equal(afterReset.find(r => r.idx === 6).main_follow, 'skip_restricted');

  const resetProt = run('run', {}, ['reset-held', '--include-protected']);
  assert.equal(resetProt.status, 0, resetProt.stderr);
  assert.equal(JSON.parse(read('ledger.json')).find(r => r.idx === 3).main_follow, '');
});

test('同日二次刷新登记表立即记录当日消失账号，且重关告警触发 doctor WARN', () => {
  reset();
  for (const f of fs.readdirSync(data)) {
    if (/^main_following_/.test(f) || /_gallery\.html$/.test(f)) fs.rmSync(path.join(data, f), { force: true });
  }
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
  write('unfollow_registry.json', {
    entries: { 'prior-unfollowed': { nickname: '旧取关', douyin_id: 'old_u', last_seen: '2026-01-01', unfollowed_since: '2026-01-02' } }
  });
  const first = run('update_registry', {
    count: 2,
    listResponse: { status_code: 0, has_more: 0, followings: [
      { sec_uid: 'morning-drop', nickname: '早间关注', unique_id: 'm_drop' },
      { sec_uid: 'still-here', nickname: '仍在关注', unique_id: 's_here' },
    ] }
  });
  assert.equal(first.status, 0, first.stderr);

  const second = run('update_registry', {
    count: 2,
    listResponse: { status_code: 0, has_more: 0, followings: [
      { sec_uid: 'still-here', nickname: '仍在关注', unique_id: 's_here' },
      { sec_uid: 'prior-unfollowed', nickname: '重关昵称', unique_id: 'old_u' },
    ] }
  });
  assert.equal(second.status, 0, second.stderr);
  const reg = JSON.parse(read('unfollow_registry.json'));
  assert.equal(reg.entries['morning-drop']?.last_seen, today);
  assert.equal(reg.entries['morning-drop']?.unfollowed_since, today);
  assert.equal(reg.refollow_alerts?.length, 1);
  assert.equal(reg.refollow_alerts[0].sec_uid, 'prior-unfollowed');
  const merged = JSON.parse(read(`main_following_${today}.json`));
  assert.deepEqual(merged.map(u => u.sec_uid).sort(), ['morning-drop', 'prior-unfollowed', 'still-here']);

  const doc = run('doctor', {});
  assert.equal(doc.status, 0, doc.stderr);
  assert.match(doc.stdout, /\[WARN\] 已取关登记表.*疑似重新关注 1 人/);
});

test('scan_bans_latest 连续 8 次异常时保存进度并提前熔断中止', () => {
  reset();
  write('ban_latest.json', [{ sec_uid: 'intact', status: 'normal' }]);
  write('suspects_latest.json', []);
  const accounts = {};
  for (let i = 1; i <= 12; i++) {
    const id = 'u' + String(i).padStart(2, '0');
    accounts[id] = { sec_uid: id, nickname: '测试' + i, douyin_id: 'd' + i, works: 2, n_visible: 0, times: [] };
  }
  write('snapshot_latest.json', { exported_at: '2026-06-01T00:00:00Z', accounts });
  const res = run('scan_bans_latest', { main: 1, failAfter: 1 });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /主页核验连续失败过多.*已保存核验进度/);
  const readLines = fs.readFileSync(path.join(fixture, 'reads'), 'utf8').trim().split('\n');
  assert.equal(readLines.length, 9, '第 1 个成功后连续 8 次失败即中止，不继续请求后续账号');
  const saved = JSON.parse(read('.profile-progress.json'));
  assert.equal(saved.records.u01?.record?.status, 'normal');
  assert.ok(!saved.records.u02);
  assert.equal(JSON.parse(read('ban_latest.json'))[0].sec_uid, 'intact');
});

test('停更画廊无可见日期防假阳性（B8.1）且 topicChange 支持全部 12 类垂类并排除纯带货词（O4.2）', async () => {
  reset();
  const previous = '2026-04-01T00:00:00Z', current = '2026-06-01T00:00:00Z';
  const priorSec = Date.parse(previous) / 1000;
  write('snapshot_previous.json', {
    exported_at: previous,
    accounts: {
      nodate_both: { sec_uid: 'nodate_both', nickname: '无日期甲', douyin_id: 'd1', works: 0, followers: 10, times: [] },
      had_date: { sec_uid: 'had_date', nickname: '曾有日期乙', douyin_id: 'd2', works: 3, followers: 20, times: [priorSec - 10 * 86400] },
    }
  });
  write('snapshot_latest.json', {
    exported_at: current,
    accounts: {
      nodate_both: { sec_uid: 'nodate_both', nickname: '无日期甲', douyin_id: 'd1', works: 3, followers: 10, times: [] },
      had_date: { sec_uid: 'had_date', nickname: '曾有日期乙', douyin_id: 'd2', works: 3, followers: 20, times: [] },
    }
  });
  write('ban_latest.json', [
    { sec_uid: 'nodate_both', status: 'normal', works_fresh: 3, secret: 0 },
    { sec_uid: 'had_date', status: 'normal', works_fresh: 3, secret: 0 },
  ]);
  write('suspects_latest.json', []);
  const built = run('gen_stale_gallery', {});
  assert.equal(built.status, 0, built.stderr);
  const staleData = galleryPayload(read('stale_gallery.html')).data;
  const noDateRow = staleData.find(d => d.sec_uid === 'nodate_both');
  const hadDateRow = staleData.find(d => d.sec_uid === 'had_date');
  assert.equal(noDateRow.group, 'unknown');
  assert.ok(!noDateRow.changes.includes('活动分组变化'));
  assert.ok(!noDateRow.changeFacts.some(f => f.includes('无可见日期，本次 无可见日期')));
  assert.equal(hadDateRow.group, 'unknown');
  assert.ok(hadDateRow.changes.includes('活动分组变化'));

  const { topicChange } = await import('./topic-change.mjs');
  const pairs = [
    [['家常菜谱教程', '周末烘焙食材'], ['徒步露营装备', '海边景区酒店'], '美食 → 旅行'],
    [['桌面硬件评测', '开源编程软件'], ['周末篮球训练', '网球跑步打卡'], '数码 → 运动'],
    [['水彩风景插画', '素描速写画材'], ['直播带货复盘', '供应链管理选品'], '绘画 → 电商'],
    [['秋冬护肤粉底', '日常彩妆口红'], ['手游排位攻略', '二次元漫展现场'], '美妆穿搭 → 游戏动漫'],
    [['年度财报股票', '家庭基金理财'], ['新能源车试驾', '二手车买房装修'], '财经法律 → 汽车房产'],
    [['科学育儿辅食', '考研考公备考'], ['中医养生减脂', '医学科普康复'], '母婴教育 → 医疗健康'],
  ];
  for (const [before, after, expected] of pairs) {
    assert.equal(topicChange(before, after)?.label, expected);
  }
  assert.equal(topicChange(['水彩风景插画', '素描速写画材'], ['橱窗好物同款下单秒杀', '限时福利优惠券团购促销']), null);
});

test('driver2 单账号身份或关注失败不死循环且不阻塞后续账号，风控则立即中止', () => {
  reset();
  write('ledger.json', [
    { idx: 1, sec_uid: 'mismatch-sec', douyin_id: 'wrong_id', nickname: '不匹配旧名', main_follow: '', alt_unfollow: '' },
    { idx: 2, sec_uid: sec, douyin_id: 'abc', nickname: '测试', main_follow: '', alt_unfollow: '' },
  ]);
  const mixed = run('driver2', { allowClick: true, main: [0, 1], alt: [1, 0] });
  assert.equal(mixed.status, 0, mixed.stderr);
  assert.match(mixed.stdout, /\[WARN\].*待重试\/未完成 1/);
  const afterMixed = JSON.parse(read('ledger.json'));
  assert.equal(afterMixed[0].fail_count, 1);
  assert.equal(afterMixed[1].alt_unfollow, 'done');

  reset();
  write('ledger.json', [{ ...record, main_follow: '', alt_unfollow: '' }]);
  const followFail = run('driver2', { allowClick: true, main: 0 });
  assert.equal(followFail.status, 0, followFail.stderr);
  assert.equal(JSON.parse(read('ledger.json'))[0].main_follow, 'follow_fail');

  reset();
  write('ledger.json', [{ ...record, main_follow: '', alt_unfollow: '' }]);
  const risked = run('driver2', { allowClick: true, main: 0, bodyText: '抖音号：abc 操作过于频繁' });
  assert.equal(risked.status, 1);
  assert.match(risked.stdout, /出现平台风控限制/);
  assert.equal(JSON.parse(read('ledger.json'))[0].main_follow, 'risk_paused');
});

test('merge_incremental 同步最新资料并为小号重关命中登记表发出 WARN', () => {
  reset();
  write('ledger.json', [
    { idx: 1, sec_uid: sec, douyin_id: 'old_id', nickname: '旧昵称', main_follow: 'done', alt_unfollow: 'done' },
  ]);
  write('unfollow_registry.json', {
    entries: { [sec]: { unfollowed_since: '2026-01-01', reason: '人工取关' } },
  });
  write('in.json', {
    list: [{ sec_uid: sec, nickname: '最新昵称', unique_id: 'new_id', short_id: '123' }],
  });
  const merged = run('merge_incremental', {}, ['data/in.json']);
  assert.equal(merged.status, 0, merged.stderr);
  assert.match(merged.stdout, /\[WARN\].*命中已取关登记表 1 人/);
  const [row] = JSON.parse(read('ledger.json'));
  assert.equal(row.nickname, '最新昵称');
  assert.equal(row.douyin_id, 'new_id');
  assert.equal(row.alt_unfollow, '');
  assert.equal(row.alt_fail_count, 0);
});

test('final_verify --incremental 复用未变动已完成记录，仅请求新增记录', () => {
  reset();
  write('ledger.json', [
    { idx: 1, sec_uid: sec, douyin_id: 'abc', nickname: '测试', main_follow: 'done', alt_unfollow: 'done' },
    { idx: 2, sec_uid: 'second-sec', douyin_id: 'abc', nickname: '测试', main_follow: 'already', alt_unfollow: 'done' },
  ]);
  const full = run('final_verify', { main: 1, alt: 0 });
  assert.equal(full.status, 0, full.stderr);
  fs.rmSync(path.join(fixture, 'reads'), { force: true });

  const rows = JSON.parse(read('ledger.json'));
  rows.push({ idx: 3, sec_uid: 'third-sec', douyin_id: 'abc', nickname: '测试', main_follow: 'done', alt_unfollow: 'done' });
  write('ledger.json', rows);
  const inc = run('final_verify', { main: 1, alt: 0 }, ['--incremental']);
  assert.equal(inc.status, 0, inc.stderr);
  const reads = fs.readFileSync(path.join(fixture, 'reads'), 'utf8').trim().split('\n');
  assert.deepEqual(reads, ['main third-sec', 'alt third-sec']);
  assert.equal(JSON.parse(read('verify.json')).rows.length, 3);
});

test('reset-held 不重置已完成行，且能清理未挂起行的残留异常计数', () => {
  reset();
  write('ledger.json', [
    { idx: 1, sec_uid: 'done-row', douyin_id: 'd1', nickname: '已完成', main_follow: 'done', alt_unfollow: 'done', fail_count: 2 },
    { idx: 2, sec_uid: 'dirty-pending', douyin_id: 'd2', nickname: '残留计数', main_follow: '', alt_unfollow: '', fail_count: 2, alt_fail_count: 1 },
    { idx: 3, sec_uid: 'held-rest', douyin_id: 'd3', nickname: '受限保留', main_follow: 'skip_restricted', alt_unfollow: '', fail_count: 1 },
  ]);
  const res = run('run', {}, ['reset-held']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /已重置 1 条/);
  const rows = JSON.parse(read('ledger.json'));
  assert.equal(rows[0].fail_count, 2);
  assert.equal(rows[1].fail_count, 0);
  assert.equal(rows[1].alt_fail_count, 0);
  assert.equal(rows[2].main_follow, 'skip_restricted');
});

test('normalizeFileUrl 统一 Windows 本地路径大小写并移除 hash', () => {
  const norm = normalizeFileUrl('file:///F:/Project/data/review_gallery.html#account=abc');
  if (process.platform === 'win32') {
    assert.equal(norm, normalizeFileUrl('file:///f:/Project/data/review_gallery.html#other'));
  } else {
    assert.equal(norm, 'file:///F:/Project/data/review_gallery.html');
  }
});

test('doctor 在核心 JSON 为非数组对象或缺失保护名单时准确报 FAIL 且不崩溃', () => {
  reset();
  write('ban_latest.json', {});
  write('suspects_latest.json', {});
  fs.rmSync(path.join(data, 'user_keep_list.json'));
  const res = run('doctor', {});
  assert.equal(res.status, 1);
  assert.match(res.stdout, /\[FAIL\] 保留名单/);
  assert.match(res.stdout, /\[FAIL\] 嫌疑库\(新\)/);
  assert.match(res.stdout, /\[FAIL\] 处罚核验\(新\)/);
});

test('batch_unfollow 同名单分批续跑跳过已完成项，精确匹配列名并兼容空白与公式前缀', () => {
  reset();
  const s1 = 'batch-u1', s2 = 'batch-u2';
  write('unfollow_state.json', { done: { [s1]: '2026-01-01' } });
  write('multi.csv', [
    '上次昵称,本次昵称,原抖音号,抖音号,sec_uid',
    `旧一,  '=测试一 ,old1,id1,${s1}`,
    `旧二,  '-测试二 ,old2,id2,${s2}`,
  ].join('\n'));
  const first = run('batch_unfollow', { allowClick: true, buttonText: '已关注', main: [1, 0], docTitle: '=测试一', bodyText: '抖音号：id1', targetNickname: '=测试一', targetId: 'id1' }, ['--list', 'data/multi.csv', '--execute', '--limit', '1']);
  assert.equal(first.status, 0, first.stderr);
  assert.match(read('unfollow_report.csv'), /batch-u1/);
  assert.doesNotMatch(read('unfollow_report.csv'), /batch-u2/);

  const second = run('batch_unfollow', { allowClick: true, buttonText: '已关注', main: [1, 0], docTitle: '-测试二', bodyText: '抖音号：id2', targetNickname: '-测试二', targetId: 'id2' }, ['--list', 'data/multi.csv', '--execute', '--limit', '1']);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /已完成跳过 1 条/);
  assert.match(read('unfollow_report.csv'), /batch-u2/);
  assert.doesNotMatch(read('unfollow_report.csv'), /batch-u1/);
});

test('transfer 按钮文案不符不误点、大号成功即时落盘、重试及 reset-held 清理备注并保留曾用名', () => {
  reset();
  write('ledger.json', [{ idx: 1, sec_uid: sec, douyin_id: 'abc', nickname: '测试', main_follow: '', alt_unfollow: '', note: 'main关注复查未变(第1次, 继续下一个)', fail_count: 1 }]);
  const mismatch = run('transfer', { allowClick: true, buttonText: '已关注', main: 0 });
  assert.equal(mismatch.status, 0, mismatch.stderr);
  untouched();
  assert.equal(JSON.parse(read('ledger.json'))[0].main_follow, 'follow_fail');

  reset();
  const partial = run('transfer', { allowClick: true, main: [0, 1], failAfter: 2 });
  assert.notEqual(partial.status, 0);
  const afterPartial = JSON.parse(read('ledger.json'))[0];
  assert.equal(afterPartial.main_follow, 'done');
  assert.equal(afterPartial.alt_unfollow, '');

  reset();
  write('ledger.json', [{ idx: 1, sec_uid: sec, douyin_id: 'abc', nickname: '旧名甲', main_follow: '', alt_unfollow: '', note: 'main身份核对失败:x/y', fail_count: 2 }]);
  const renamed = run('transfer', { allowClick: true, main: [0, 1], alt: [1, 0], targetNickname: '新名甲', targetId: 'abc' });
  assert.equal(renamed.status, 0, renamed.stderr);
  const doneRow = JSON.parse(read('ledger.json'))[0];
  assert.equal(doneRow.alt_unfollow, 'done');
  assert.equal(doneRow.fail_count, 0);
  assert.equal(doneRow.note, '');
  assert.deepEqual(doneRow.former_nicknames, ['旧名甲']);

  write('snapshot_latest.json', { exported_at: '2026-06-01T00:00:00Z', accounts: { [sec]: { nickname: '新名甲', captions: [] } } });
  assert.equal(run('build_suspects_latest', {}).status, 0);
  const suspects = JSON.parse(read('suspects_latest.json'));
  assert.equal(suspects.length, 1);
  assert.equal(suspects[0].nickname_first, '旧名甲');

  write('ledger.json', [{ idx: 1, sec_uid: sec, douyin_id: 'abc', nickname: '测试', main_follow: 'id_check_fail', alt_unfollow: '', fail_count: 3, note: 'main身份核对失败:x/y; 重试3次仍失败' }]);
  assert.equal(run('run', {}, ['reset-held']).status, 0);
  assert.equal(JSON.parse(read('ledger.json'))[0].note, '');
});

test('refresh 发布联动更新取关登记表、保留名单豁免重关告警，accept-refollow 可清除告警', () => {
  reset();
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
  write('unfollow_registry.json', {
    entries: {
      'user-alert': { nickname: '曾取关甲', douyin_id: 'ua', last_seen: '2026-01-01', unfollowed_since: '2026-01-02' },
      'user-keep': { nickname: '永久保留乙', douyin_id: 'uk', last_seen: '2026-01-01', unfollowed_since: '2026-01-02' },
    }
  });
  write('user_keep_list.json', { keeps: [{ sec_uid: 'user-keep', nickname: '永久保留乙' }] });
  const scene = {
    count: 2, main: 1, posts: { status_code: 0, aweme_list: [] },
    listResponse: {
      status_code: 0, has_more: 0,
      followings: [
        { sec_uid: 'user-alert', nickname: '重关新名甲', unique_id: 'ua', aweme_count: 1 },
        { sec_uid: 'user-keep', nickname: '永久保留乙', unique_id: 'uk', aweme_count: 1 },
      ],
    },
  };
  const refreshed = run('run', scene, ['refresh']);
  assert.equal(refreshed.status, 0, refreshed.stderr);
  const reg = JSON.parse(read('unfollow_registry.json'));
  assert.equal(reg.refollow_alerts.length, 1);
  assert.equal(reg.refollow_alerts[0].sec_uid, 'user-alert');
  assert.ok(fs.existsSync(path.join(data, `main_following_${today}.json`)));

  const accepted = run('run', {}, ['accept-refollow', '--all']);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /移出 1 位/);
  const regAfter = JSON.parse(read('unfollow_registry.json'));
  assert.equal(regAfter.refollow_alerts.length, 0);
  assert.ok(!regAfter.entries['user-alert']);
});
