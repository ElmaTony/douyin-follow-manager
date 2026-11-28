import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { normalizeFileUrl } from './core.mjs';

// Only the top-level local gallery can request navigation of its dedicated tab.
export async function attachProfileTab(context, galleryPaths) {
  const allowed = new Set(galleryPaths.map(p=>normalizeFileUrl(pathToFileURL(path.resolve(p)).href)));
  let tab, lastUrl, opening = false;
  await context.exposeBinding('guanxuOpenProfile',async ({frame,page},sec)=>{
    let caller = '';
    try {
      const u = new URL(frame.url());
      u.hash = '';
      caller = normalizeFileUrl(u.href);
    } catch {
      return false;
    }
    if (frame !== page.mainFrame() || !allowed.has(caller) ||
        typeof sec !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(sec)) return false;
    if (opening) return false;
    opening = true;
    let created;
    try {
      // Preserve a tab the user has since taken elsewhere, including a work or a login page.
      if (!tab || tab.isClosed() || tab.url() !== lastUrl) {
        created = await context.newPage();
        tab = created;
      }
      const url = 'https://www.douyin.com/user/'+encodeURIComponent(sec);
      if (tab.url() !== url) await tab.goto(url,{waitUntil:'commit',timeout:15000});
      const landed = new URL(tab.url());
      lastUrl = landed.origin+landed.pathname.replace(/\/$/,'') === url &&
        !landed.hash && !landed.searchParams.has('modal_id') ? landed.href : null;
      await tab.bringToFront();
      return true;
    } catch {
      if (created && !created.isClosed() && created.url()==='about:blank') await created.close().catch(()=>{});
      return false;
    }
    finally { opening=false; }
  });
}
