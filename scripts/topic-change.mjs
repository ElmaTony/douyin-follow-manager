const topics = [
  ['美食', /菜谱|食材|烘焙|烹饪|美食/], ['旅行', /旅行|景区|酒店|徒步|露营/],
  ['数码', /编程|硬件|软件|评测|数码/], ['运动', /篮球|网球|跑步|训练|足球/],
  ['电商', /电商运营|直播带货|直播运营|商品选品|供应链管理/], ['绘画', /绘画|水彩|插画|画材|素描/],
];

export function dominantTopic(captions) {
  const distinct = [...new Set(captions.map(t => t.normalize('NFKC').trim()).filter(Boolean))];
  const scored = topics.map(([name,pattern]) => ({ name, hits:distinct.filter(t=>pattern.test(t)) }))
    .sort((a,b)=>b.hits.length-a.hits.length);
  return scored[0].hits.length >= 2 && scored[0].hits.length > scored[1].hits.length ? scored[0] : null;
}

export function topicChange(oldCaptions, newCaptions) {
  const old = dominantTopic(oldCaptions), now = dominantTopic(newCaptions);
  if (!old || !now || old.name === now.name) return null;
  const signatures = values => new Set(values.map(t=>t.normalize('NFKC').trim()));
  const oldSet = signatures(oldCaptions), newSet = signatures(newCaptions);
  const before = old.hits.filter(t=>!newSet.has(t)), after = now.hits.filter(t=>!oldSet.has(t));
  if (before.length < 2 || after.length < 2) return null;
  return { before, after, label:old.name+' → '+now.name };
}
