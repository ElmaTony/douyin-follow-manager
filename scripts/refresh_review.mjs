/** 在线采集、分析、保护名单核验和画廊生成在同一临时工作目录完成。 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { galleryPayload, readJson } from './core.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(scripts), data = path.join(root,'data');
const ready = path.join(data,'.review-ready');
const html = ['review_gallery.html','stale_gallery.html','suspect_gallery.html'];
const files = ['snapshot_latest.json','suspects_latest.json','ban_latest.json',...html];
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function publish() {
  const hashes = JSON.parse(fs.readFileSync(path.join(ready,'manifest.json'),'utf8'));
  const pending = [];
  const names = Object.hasOwn(hashes,'snapshot_previous.json') ? [...files,'snapshot_previous.json'] : files;
  for (const name of names) {
    const from = path.join(ready,name), to = path.join(data,name);
    const staged = fs.existsSync(from);
    if (digest(staged ? from : to) !== hashes[name]) throw new Error('待发布内容校验失败：' + name);
    if (staged) pending.push({from,to});
  }
  for (const {from,to} of pending) fs.renameSync(from,to);
  // Rename the completed transaction before removing its manifest. An interruption here is harmless.
  const done = fs.mkdtempSync(path.join(data,'.review-finished-'));
  fs.renameSync(ready,path.join(done,'published'));
  fs.unlinkSync(path.join(done,'published','manifest.json'));
  fs.rmdirSync(path.join(done,'published'));
  fs.rmdirSync(done);
  const publishedAt = readJson(path.join(data,'snapshot_latest.json'))?.exported_at;
  if (publishedAt) for (const name of ['.snapshot-progress.json','.profile-progress.json']) {
    const progress = path.join(data,name);
    if (readJson(progress)?.exported_at === publishedAt) fs.rmSync(progress,{force:true});
  }
  console.log('最新快照、处罚核验和三个审阅画廊已发布。');
}
if (fs.existsSync(ready)) {
  console.log('继续发布上次已核验的数据…');
  publish();
} else {
  const work = fs.mkdtempSync(path.join(data,'.review-work-'));
  const staged = path.join(work,'data');
  try {
    fs.mkdirSync(staged);
    const previous = readJson(path.join(data,'snapshot_latest.json'));
    fs.writeFileSync(path.join(staged,'snapshot_previous.json'),JSON.stringify(previous?.accounts ? previous : {}));
    for (const file of ['data/ledger.json','data/user_keep_list.json','data/review_pending.json','data/unfollow_registry.json','data/gallery_preset_keep.json']) {
      if (!fs.existsSync(path.join(root,file))) continue;
      fs.mkdirSync(path.dirname(path.join(work,file)),{recursive:true});
      fs.copyFileSync(path.join(root,file),path.join(work,file));
    }
    for (const step of ['snapshot_main','build_suspects_latest','scan_bans_latest','gen_review_gallery','gen_stale_gallery','gen_suspect_gallery']) {
      console.log('▶ ' + step);
      const r = spawnSync(process.execPath,[path.join(scripts,step+'.mjs')],{cwd:work,stdio:'inherit',windowsHide:true});
      if (r.status !== 0) throw new Error('在线更新中止，保留原审阅数据。失败步骤：' + step);
    }
    for (const name of html) galleryPayload(fs.readFileSync(path.join(staged,name),'utf8'));
    const bundle = path.join(work,'complete');
    fs.mkdirSync(bundle);
    const hashes = {};
    for (const name of [...files,'snapshot_previous.json']) {
      const source = path.join(staged,name);
      hashes[name] = digest(source);
      fs.renameSync(source,path.join(bundle,name));
    }
    fs.writeFileSync(path.join(bundle,'manifest.json'),JSON.stringify(hashes),'utf8');
    fs.renameSync(bundle,ready);
    publish();
  } finally {
    if (path.dirname(work) === data && path.basename(work).startsWith('.review-work-')) fs.rmSync(work,{recursive:true,force:true});
  }
}
