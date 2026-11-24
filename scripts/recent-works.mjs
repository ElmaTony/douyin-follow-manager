// Keep cover, caption, time and work ID together from the same response item.
export async function readRecentWorks(page, sec, common) {
  return page.evaluate(async ({sec,common}) => {
    const query = new URLSearchParams({...common,sec_user_id:sec,count:'20',max_cursor:'0',locate_query:'false',source:'channel_pc_web'});
    const res = await fetch('https://www.douyin.com/aweme/v1/web/aweme/post/?'+query,{credentials:'include'});
    const body = JSON.parse(await res.text());
    if (body.status_code !== 0 || !(Array.isArray(body.aweme_list) || body.aweme_list === null)) throw Error('作品列表未完整返回');
    const list = body.aweme_list || [];
    return list.map(x => {
      if (x.author?.sec_uid && x.author.sec_uid !== sec) throw Error('作品作者不符');
      const urls = [...new Set([...(x.video?.cover?.url_list || []), ...(x.images?.[0]?.url_list || [])])]
        .filter(u=>typeof u==='string' && u.startsWith('https://'));
      return {id:String(x.aweme_id || ''),time:x.create_time || 0, caption:String(x.desc || '').trim().slice(0,500),
        cover:urls[0] || '', alternateCover:urls[1] || '',
        type:x.images?.length ? 'note' : 'video', ai:x.is_aigc_media === true};
    }).sort((a,b)=>b.time-a.time);
  },{sec,common});
}
