/**
 * api.js — every database call the organiser pages make.
 * Columns are always named: organisers cannot read token hashes, so
 * `select('*')` on contributions would fail by design.
 */
import { supabase } from './supabase.js';

const GIFT_COLUMNS = [
  'id', 'slug', 'couple_names', 'wedding_date', 'gift_title', 'gift_story', 'target_paise',
  'organiser_name', 'organiser_upi', 'deadline', 'show_amounts', 'status', 'razorpay_link', 'created_at', 'updated_at',
].join(', ');

/** Thrown when a gift doesn't exist or belongs to someone else (RLS hides both the same way). */
export class NotFoundError extends Error {
  constructor() {
    super('NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

/** @param {{ error: any }} result */
function unwrap({ data, error }) {
  if (error) {
    if (error.code === 'PGRST116') throw new NotFoundError(); // .single() matched no row
    throw error;
  }
  return data;
}

/**
 * The organiser's gifts, newest first, each with its confirmed total and
 * how many payments are waiting for the organiser to confirm.
 * @returns {Promise<Array<object & { confirmed_paise: number, confirmed_count: number, waiting_count: number }>>}
 */
export async function listMyGifts() {
  const gifts = unwrap(await supabase.from('group_gifts').select(GIFT_COLUMNS).order('created_at', { ascending: false }));
  if (!gifts.length) return [];

  const rows = unwrap(await supabase
    .from('contributions')
    .select('gift_id, amount_paise, status')
    .in('status', ['confirmed', 'marked_paid'])
    .in('gift_id', gifts.map((g) => g.id)));

  const totals = new Map();
  for (const row of rows) {
    const t = totals.get(row.gift_id) || { paise: 0, count: 0, waiting: 0 };
    if (row.status === 'confirmed') {
      t.paise += Number(row.amount_paise);
      t.count += 1;
    } else {
      t.waiting += 1;
    }
    totals.set(row.gift_id, t);
  }
  return gifts.map((g) => ({
    ...g,
    confirmed_paise: totals.get(g.id)?.paise ?? 0,
    confirmed_count: totals.get(g.id)?.count ?? 0,
    waiting_count: totals.get(g.id)?.waiting ?? 0,
  }));
}

/**
 * One of the organiser's gifts.
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function getMyGift(id) {
  return unwrap(await supabase.from('group_gifts').select(GIFT_COLUMNS).eq('id', id).single());
}

/**
 * The name and UPI ID from the organiser's latest gift, to prefill a new one.
 * @returns {Promise<{ organiser_name: string, organiser_upi: string }|null>}
 */
export async function getLastPayoutDetails() {
  const rows = unwrap(await supabase
    .from('group_gifts')
    .select('organiser_name, organiser_upi')
    .order('created_at', { ascending: false })
    .limit(1));
  return rows[0] ?? null;
}

/**
 * Create a gift page. The owner is set by the database from the session.
 * @param {object} fields validated columns from validateGift()
 * @returns {Promise<{ id: string, slug: string }>}
 */
export async function createGift(fields) {
  return unwrap(await supabase.from('group_gifts').insert(fields).select('id, slug').single());
}

/**
 * Save changes to one of the organiser's gifts.
 * @param {string} id
 * @param {object} fields validated columns from validateGift()
 * @returns {Promise<{ id: string, slug: string }>}
 */
export async function updateGift(id, fields) {
  return unwrap(await supabase.from('group_gifts').update(fields).eq('id', id).select('id, slug').single());
}

const CONTRIBUTION_COLUMNS = [
  'id', 'gift_id', 'contributor_name', 'amount_paise', 'blessing', 'blessing_hidden',
  'show_name', 'status', 'source', 'confirmed_at', 'created_at',
].join(', ');

/**
 * Every contribution to one of the organiser's gifts, newest first.
 * @param {string} giftId
 * @returns {Promise<Array<object>>}
 */
export async function listContributions(giftId) {
  return unwrap(await supabase
    .from('contributions')
    .select(CONTRIBUTION_COLUMNS)
    .eq('gift_id', giftId)
    .order('created_at', { ascending: false }));
}

/**
 * Confirm, reject or reopen a contribution.
 * @param {string} id
 * @param {'confirmed'|'rejected'|'marked_paid'} status
 * @returns {Promise<object>} the updated row
 */
export async function setContributionStatus(id, status) {
  return unwrap(await supabase.from('contributions').update({ status }).eq('id', id).select(CONTRIBUTION_COLUMNS).single());
}

/**
 * Hide an inappropriate blessing from the public wall, or show it again.
 * @param {string} id
 * @param {boolean} hidden
 * @returns {Promise<object>}
 */
export async function setBlessingHidden(id, hidden) {
  return unwrap(await supabase.from('contributions').update({ blessing_hidden: hidden }).eq('id', id).select(CONTRIBUTION_COLUMNS).single());
}

/**
 * Record cash (or any money received outside the app). It counts straight away.
 * @param {string} giftId
 * @param {{ name: string, amountPaise: number, blessing: string, showName: boolean }} entry
 * @returns {Promise<object>}
 */
export async function addCashContribution(giftId, { name, amountPaise, blessing, showName }) {
  return unwrap(await supabase.from('contributions').insert({
    gift_id: giftId,
    contributor_name: name,
    amount_paise: amountPaise,
    blessing,
    show_name: showName,
    status: 'confirmed',
    source: 'cash',
  }).select(CONTRIBUTION_COLUMNS).single());
}

/**
 * Close a gift to new pledges, or reopen it.
 * @param {string} id
 * @param {'active'|'closed'} status
 * @returns {Promise<object>}
 */
export async function setGiftStatus(id, status) {
  return unwrap(await supabase.from('group_gifts').update({ status }).eq('id', id).select(GIFT_COLUMNS).single());
}

/**
 * Delete a gift and, with it, every contribution and blessing.
 * @param {string} id
 */
export async function deleteGift(id) {
  const rows = unwrap(await supabase.from('group_gifts').delete().eq('id', id).select('id'));
  if (!rows.length) throw new NotFoundError();
}

/**
 * Turn any error from Supabase or the network into one short, kind sentence.
 * @param {any} error
 * @returns {string}
 */
export function friendlyError(error) {
  const code = error?.code || '';
  const status = error?.status;
  const message = String(error?.message || '');

  if (!navigator.onLine || /failed to fetch|networkerror|load failed|network request failed/i.test(message) || status === 0) {
    return 'You seem to be offline. Check your connection and try again.';
  }
  if (error instanceof NotFoundError) return 'We couldn\'t find that gift. It may have been deleted.';
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || status === 429) {
    return 'We\'ve sent a few links already. Please wait a few minutes, then try again.';
  }
  if (code === 'email_address_invalid' || code === 'validation_failed') {
    return 'That email address doesn\'t look right. Please check it.';
  }
  if (code === 'PGRST301' || code === 'PGRST303' || /jwt expired/i.test(message)) {
    return 'Your session has ended. Please sign in again.';
  }
  if (code === '23514') return 'Some details didn\'t pass our checks. Please review the form.';
  if (code === '42501') return 'You don\'t have permission to do that.';
  return 'Something went wrong on our side. Please try again.';
}

// ---------------------------------------------------------------------------
// Public gift page (friends, no login). Everything goes through the
// SECURITY DEFINER functions; friends have no direct table access.
// ---------------------------------------------------------------------------

/**
 * A gift's public details, or null when the slug doesn't exist.
 * @param {string} slug
 * @returns {Promise<object|null>}
 */
export async function getPublicGift(slug) {
  const rows = unwrap(await supabase.rpc('get_public_gift', { p_slug: slug }));
  return rows?.[0] ?? null;
}

/**
 * The blessings wall, newest first.
 * @param {string} slug
 * @returns {Promise<Array<{ name: string, amount_paise: number|null, blessing: string, created_at: string }>>}
 */
export async function getPublicBlessings(slug) {
  return unwrap(await supabase.rpc('get_public_blessings', { p_slug: slug })) ?? [];
}

/**
 * Record a friend's pledge.
 * @param {string} slug
 * @param {{ name: string, amountPaise: number, blessing: string, showName: boolean }} pledge
 * @returns {Promise<{ contribution_id: string, edit_token: string }>}
 */
export async function createPledge(slug, { name, amountPaise, blessing, showName }) {
  const rows = unwrap(await supabase.rpc('create_pledge', {
    p_slug: slug,
    p_name: name,
    p_amount_paise: amountPaise,
    p_blessing: blessing,
    p_show_name: showName,
  }));
  return rows[0];
}

/**
 * Tell the organiser this pledge has been paid.
 * @param {string} id
 * @param {string} token
 * @returns {Promise<string>} the pledge's status afterwards
 */
export async function markPaid(id, token) {
  return unwrap(await supabase.rpc('mark_paid', { p_contribution_id: id, p_token: token }));
}

/**
 * The latest status of a pledge saved on this device, or null if it's gone.
 * @param {string} id
 * @param {string} token
 * @returns {Promise<{ status: string, amount_paise: number, contributor_name: string, created_at: string }|null>}
 */
export async function getMyPledge(id, token) {
  const rows = unwrap(await supabase.rpc('get_my_pledge', { p_contribution_id: id, p_token: token }));
  return rows?.[0] ?? null;
}

/**
 * Messages for the errors the pledge functions raise on purpose.
 * @param {any} error
 * @returns {string}
 */
export function pledgeErrorMessage(error) {
  switch (error?.message) {
    case 'GIFT_CLOSED': return 'This gift has closed, so it can\'t take new pledges.';
    case 'DEADLINE_PASSED': return 'The deadline for this gift has passed.';
    case 'GIFT_FULL': return 'This gift has reached the most pledges it can take.';
    case 'GIFT_NOT_FOUND': return 'We couldn\'t find this gift. It may have been deleted.';
    case 'INVALID_TOKEN': return 'We couldn\'t match this pledge to your device.';
    default: return friendlyError(error);
  }
}
