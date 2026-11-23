/** 离线回归。命令运行在临时项目中，页面和账号状态均为本地模拟。 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { confirmedStatus } from './account-checks.mjs';
import { snapshotTime, staleAtSnapshot } from './core.mjs';

const sources = fileURLToPath(new URL('.', import.meta.url));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-offline-'));
const data = path.join(fixture, 'data');
fs.mkdirSync(data);
fs.mkdirSync(path.join(fixture,'scripts'));
for (const name of ['local-state.mjs','account-checks.mjs','core.mjs','unfollow_list.mjs','transfer.mjs','batch_unfollow.mjs','final_verify.mjs','merge_incremental.mjs','read_suspect_state.mjs','prep_suspect_unfollow.mjs','sync_marks.mjs','preflight_incremental.mjs','update_registry.mjs','run.mjs','open_review_env.mjs','refresh_review.mjs',
  'snapshot_main.mjs','scan_bans_latest.mjs','build_suspects_latest.mjs','gallery.mjs','gallery.css','gallery-client.js',
  'gallery-lightbox.js','gen_review_gallery.mjs','gen_stale_gallery.mjs','gen_suspect_gallery.mjs']) {
  fs.copyFileSync(path.join(sources,name),path.join(fixture,'scripts',name));
}
// The browser double executes the actual page callbacks. An unexpected click fails the test.
fs.writeFileSync(path.join(fixture,'scripts/lib.mjs'), `
import fs from 'node:fs';
const scene = JSON.parse(process.env.QA_SCENE);
export const DATA = 'data', sleep = async () => {}, randInt = () => 0, log = console.log;
export const loadLedger = () => JSON.parse(fs.readFileSync('data/ledger.json'));
export const saveLedger = rows => fs.writeFileSync('data/ledger.json',JSON.stringify(rows));
export async function launch(which) {
  const owner = [which + '-id',which + '-test-identity'];
  if (scene.review) {
    let closed;
    const page = {
      goto: async url=>fs.appendFileSync('review-urls',JSON.stringify(url)+'\\n'),
      bringToFront: async ()=>closed(),
    };
    return {page,context:{once:(_event,listener)=>{closed=listener;},close:async()=>{},newPage:async()=>page}};
  }
  let address = '';
  return {context:{close:async()=>{}},page:{
    goto:async url=>{address=url;},
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
      globalThis.document = {title:'测试',body:{innerText:'抖音号：abc'},querySelectorAll:()=>{
        fs.appendFileSync('click-attempt','x');throw Error('Unexpected button access');
      }};
      globalThis.fetch = async url => ({text:async()=>JSON.stringify(scene.posts),json:async()=>{
        if (url.includes('/self/')) return {status_code:0,user:{following_count:scene.count ?? 1,short_id:scene.wrongOwner?'0':owner[0],sec_uid:owner[1]+'-fixture'}};
        if (url.includes('/following/list/')) return scene.listResponse;
        fs.appendFileSync('reads',which+' '+target+'\\n');
        return {status_code:0,user:{sec_uid:new URL(url).searchParams.get('sec_user_id'),follow_status:scene[which]}};
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
  for (const file of ['click-attempt','reads']) fs.rmSync(path.join(fixture,file),{force:true});
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
test('只有目标账号的明确 0 或 1 可作为关注状态', () => {
  for(const follow_status of [0,1]) assert.equal(confirmedStatus({status_code:0,sec_uid:sec,follow_status},sec),follow_status);
  for(const response of [null,{}, {status_code:1,sec_uid:sec,follow_status:1}, {status_code:0,sec_uid:'other',follow_status:1}, {status_code:0,sec_uid:sec,follow_status:2}])
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
test('已取关登记和永久保留都能拦截重新关注', () => {
  for(const keep of [true,false]){
    reset();
    if(keep)write('user_keep_list.json',{keeps:[record]});
    else write('unfollow_registry.json',{entries:{[sec]:{}}});
    const result=run('transfer',{main:0});
    assert.equal(result.status,1); assert.match(result.stderr,/已停止重新关注/); untouched();
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
    'person-b\t不应出现B\t234\t未审','person-c\t不应出现C\t345\t保留',
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
  write('stale_gallery.html','local');
  const opened=run('run',{review:true},['open','stale']);
  assert.equal(opened.status,0,opened.stderr);
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
  const original = {nickname:'示例旧名', captions:['绘画 水彩 素描'], covers:[]};
  const latest = {nickname:'示例新名', captions:['烘焙 食材 菜谱'], covers:[]};
  write('snapshot_latest.json',{accounts:{sample:latest}});
  write('snapshot_previous.json',{accounts:{sample:original}});
  assert.equal(run('build_suspects_latest',{}).status,0);
  const [change] = JSON.parse(read('suspects_latest.json'));
  assert.equal(change.tier,'high'); assert.equal(change.nickname_first,original.nickname);
  write('snapshot_previous.json',{});
  assert.equal(run('build_suspects_latest',{}).status,0);
  assert.deepEqual(JSON.parse(read('suspects_latest.json')),[]);
});
