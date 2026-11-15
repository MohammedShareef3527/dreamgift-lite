/**
 * validate.js — form rules that mirror the database constraints in
 * supabase/schema.sql, so people see a clear message before anything is sent.
 * Pure functions: no DOM, so they run in node:test too.
 */
import { rupeesToPaise, formatRupees } from './format.js';

export const LIMITS = Object.freeze({
  name: 60,
  title: 80,
  story: 500,
  blessing: 300,
  minTargetPaise: 100_00,          // ₹100
  maxTargetPaise: 1_00_00_000_00,  // ₹1 crore (matches the database)
});

/** Same pattern as the database check on razorpay_link: https, Razorpay's own domains, no query string. */
export const RAZORPAY_PATTERN = /^https:\/\/(rzp\.io|razorpay\.me|pages\.razorpay\.com)\/[A-Za-z0-9@._~/-]{1,120}$/;

/** Same pattern as the database check on organiser_upi. */
export const UPI_PATTERN = /^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,63}$/;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Length in characters as Postgres counts them (an emoji is one). */
const charLength = (text) => [...text].length;

/** @param {string} value */
function isRealDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d && y >= 2000 && y <= 2100;
}

/**
 * Today's date as YYYY-MM-DD in the person's own timezone.
 * @param {Date} [now]
 * @returns {string}
 */
export function todayISO(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Check the create/edit gift form.
 * @param {Record<string, string|boolean>} values raw form values (camelCase keys)
 * @param {{ today?: string, originalDeadline?: string|null }} [options]
 *   originalDeadline lets an existing past deadline be saved unchanged when editing.
 * @returns {{ data: object|null, errors: Record<string, string> }} data uses database column names
 */
export function validateGift(values, { today = todayISO(), originalDeadline = null } = {}) {
  const errors = {};
  const text = (key) => String(values[key] ?? '').trim();

  const coupleNames = text('coupleNames');
  if (!coupleNames) errors.coupleNames = 'Add the couple\'s names.';
  else if (charLength(coupleNames) > LIMITS.name) errors.coupleNames = `Please keep this under ${LIMITS.name} characters.`;

  const weddingDate = text('weddingDate');
  if (!weddingDate) errors.weddingDate = 'Pick the wedding date.';
  else if (!isRealDate(weddingDate)) errors.weddingDate = 'That date doesn\'t look right.';

  const giftTitle = text('giftTitle');
  if (!giftTitle) errors.giftTitle = 'Give the gift a title, like "Honeymoon dinner in Goa".';
  else if (charLength(giftTitle) > LIMITS.title) errors.giftTitle = `Please keep the title under ${LIMITS.title} characters.`;

  const giftStory = String(values.giftStory ?? '').trim();
  if (charLength(giftStory) > LIMITS.story) errors.giftStory = `Please keep the story under ${LIMITS.story} characters.`;

  const targetText = text('target');
  const targetPaise = rupeesToPaise(targetText);
  if (!targetText) errors.target = 'Add a target amount.';
  else if (targetPaise === null) errors.target = 'Enter an amount in rupees, like 60,000.';
  else if (targetPaise < LIMITS.minTargetPaise) errors.target = `The target should be at least ${formatRupees(LIMITS.minTargetPaise)}.`;
  else if (targetPaise > LIMITS.maxTargetPaise) errors.target = `The target can be up to ${formatRupees(LIMITS.maxTargetPaise)}.`;

  const organiserName = text('organiserName');
  if (!organiserName) errors.organiserName = 'Add your name so friends know who they\'re paying.';
  else if (charLength(organiserName) > LIMITS.name) errors.organiserName = `Please keep this under ${LIMITS.name} characters.`;

  const organiserUpi = text('organiserUpi').replace(/\s+/g, '').toLowerCase();
  if (!organiserUpi) errors.organiserUpi = 'Add the UPI ID friends should pay.';
  else if (!UPI_PATTERN.test(organiserUpi)) errors.organiserUpi = 'That doesn\'t look like a UPI ID. It should look like name@bank.';

  const deadline = text('deadline');
  if (deadline) {
    if (!isRealDate(deadline)) errors.deadline = 'That date doesn\'t look right.';
    else if (deadline < today && deadline !== originalDeadline) errors.deadline = 'The deadline can\'t be in the past.';
  }

  const razorpayLink = text('razorpayLink').replace(/\/+$/, '');
  if (razorpayLink && !RAZORPAY_PATTERN.test(razorpayLink)) {
    errors.razorpayLink = 'Paste a Razorpay link that starts with https://razorpay.me/, https://rzp.io/ or https://pages.razorpay.com/.';
  }

  if (Object.keys(errors).length) return { data: null, errors };
  return {
    errors,
    data: {
      couple_names: coupleNames,
      wedding_date: weddingDate,
      gift_title: giftTitle,
      gift_story: giftStory,
      target_paise: targetPaise,
      organiser_name: organiserName,
      organiser_upi: organiserUpi,
      deadline: deadline || null,
      show_amounts: values.showAmounts === true,
      razorpay_link: razorpayLink || null,
    },
  };
}

/**
 * Light email check before asking Supabase to send a link.
 * @param {string} email
 * @returns {boolean}
 */
export function looksLikeEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email).trim());
}
