// Who is allowed to use the bot. Combines env TELEGRAM_OWNER_IDS with a
// "claimed" owner persisted on first /start — so a brand-new bot becomes
// operational without the user having to look up their numeric Telegram ID.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { log } from './logger.js';

const FILE = path.join(config.dataDir, 'owners.json');

function loadClaimed() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8')).owners || [];
  } catch {
    return [];
  }
}

let claimed = loadClaimed();

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ owners: claimed }, null, 2));
}

export function listOwners() {
  return [...new Set([...config.telegram.ownerIds, ...claimed])];
}

export function isOwner(id) {
  return listOwners().includes(Number(id));
}

// Returns true if this call claimed ownership (i.e. there were no owners yet).
export function claimIfUnowned(id) {
  if (listOwners().length > 0) return false;
  claimed.push(Number(id));
  save();
  log.info(`Owner claimed via /start: ${id}`);
  return true;
}
