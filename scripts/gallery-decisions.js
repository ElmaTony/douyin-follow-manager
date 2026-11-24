// A per-author entry prevents edits to two different authors from overwriting one another.
const decisionPrefix = 'guanxu:decision:'+new URL('.',location.href).href+':';
const legacyKeys = ['review_state_v2','stale_state_v1','suspect_state_v1'];
const legacyNames = ['低作品','停更','改名与内容变更'];
let legacyRecords = [];
const decided = mark => mark === 'keep' || mark === 'unf';
function readLegacy() {
  const result = Object.create(null);
  legacyRecords = legacyKeys.map(key=>JSON.parse(localStorage.getItem(key)) || {});
  for (const records of legacyRecords) {
    for (const [sec,mark] of Object.entries(records)) {
      if (!decided(mark)) continue;
      result[sec] = result[sec] && result[sec] !== mark ? 'conflict' : mark;
    }
  }
  return result;
}
function conflictDetail(sec) {
  return legacyRecords.flatMap((records,i)=>decided(records[sec]) ?
    [legacyNames[i]+'：'+(records[sec]==='keep'?'保留':'取关')] : []).join('，');
}
function recordFor(sec) {
  return JSON.parse(localStorage.getItem(decisionPrefix+sec));
}
function readMarks() {
  const marks = Object.create(null);
  try {
    const legacy = readLegacy();
    for (const d of union) {
      const mark = recordFor(d.sec_uid)?.mark ?? legacy[d.sec_uid];
      if (mark) marks[d.sec_uid] = mark;
    }
  } catch { /* The next attempted mark reports a storage failure. */ }
  return marks;
}
function readHistory() {
  try { return JSON.parse(sessionStorage.getItem(undoKey)) || []; } catch { return []; }
}
function persistHistory() {
  try { sessionStorage.setItem(undoKey,JSON.stringify(historyStack)); } catch {}
}
function latestUndo() {
  return historyStack.findLast(entry=>byId.has(entry.sec) && !fixedLabel(byId.get(entry.sec)) &&
    (!linkedAccount || entry.sec===$('search').value));
}
// Web Locks serialize the read/check/write for edits and undo across Chrome tabs.
async function withDecisionLock(sec,action) {
  try { return await navigator.locks.request(decisionPrefix+sec,action); }
  catch { toast('标记未能保存，请检查浏览器的本地存储权限'); return false; }
}
