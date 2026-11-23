import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const dataDir = fileURLToPath(new URL('../data/', import.meta.url));

// Publish the complete initial state together. Never recreate a missing protection list in an existing workspace.
export function initialize() {
  if (fs.existsSync(dataDir)) return;
  const temp = fs.mkdtempSync(path.join(path.dirname(path.resolve(dataDir)), '.guanxu-init-'));
  try {
    for (const [name, value] of Object.entries({
      ledger: [], unfollow_registry: {entries: {}}, user_keep_list: {keeps: []}, ban_latest: [],
    })) fs.writeFileSync(path.join(temp, name + '.json'), JSON.stringify(value));
    try { fs.renameSync(temp, dataDir); }
    catch (error) { if (!fs.existsSync(dataDir)) throw error; }
  } finally { fs.rmSync(temp, {force: true, recursive: true}); }
}

export function binding(role) {
  if (!['alt', 'main'].includes(role)) throw new Error('未知账号角色');
  const file = path.join(dataDir, 'account.' + role + '.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}
