/**
 * pledges.js — remembers a friend's pledges on this device so they can come
 * back later to mark one as paid or see that it was confirmed.
 * The secret token never leaves this device except to prove the pledge is theirs.
 * Storage can be unavailable (private mode, blocked site data), so every
 * access is guarded and the page still works without it.
 */

const KEY = 'dreamgift:pledges:v1';

/** @returns {Record<string, Array<object>>} */
function readAll() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

/** @param {Record<string, Array<object>>} all */
function writeAll(all) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

/**
 * @typedef {{ id: string, token: string, amountPaise: number, name: string, createdAt: string }} SavedPledge
 */

/**
 * Pledges saved on this device for one gift, newest first.
 * @param {string} slug
 * @returns {SavedPledge[]}
 */
export function savedPledges(slug) {
  const list = readAll()[slug];
  return Array.isArray(list)
    ? list.filter((p) => p && typeof p.id === 'string' && typeof p.token === 'string')
    : [];
}

/**
 * Remember a new pledge.
 * @param {string} slug
 * @param {SavedPledge} pledge
 * @returns {boolean} false when the browser won't store it
 */
export function savePledge(slug, pledge) {
  const all = readAll();
  all[slug] = [pledge, ...savedPledges(slug).filter((p) => p.id !== pledge.id)].slice(0, 20);
  return writeAll(all);
}

/**
 * Forget a pledge (for example one the database no longer recognises).
 * @param {string} slug
 * @param {string} id
 */
export function forgetPledge(slug, id) {
  const all = readAll();
  all[slug] = savedPledges(slug).filter((p) => p.id !== id);
  if (!all[slug].length) delete all[slug];
  writeAll(all);
}
