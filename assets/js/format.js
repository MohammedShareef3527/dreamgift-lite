/**
 * format.js — money, dates and small text helpers.
 * Money is always handled as integer paise; rupees exist only for display and input.
 */

const RUPEES = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const RUPEES_PAISE = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const DATE = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const DATE_LONG = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const DAY_MS = 86_400_000;

/**
 * Format paise as Indian rupees: 10000000 → "₹1,00,000", 50050 → "₹500.50".
 * @param {number} paise
 * @returns {string}
 */
export function formatRupees(paise) {
  const value = Number(paise) || 0;
  return value % 100 === 0 ? RUPEES.format(value / 100) : RUPEES_PAISE.format(value / 100);
}

/**
 * Parse what someone typed into a rupee field ("1,000", "₹ 500.50") into paise.
 * @param {string|number} input
 * @returns {number|null} integer paise, or null when it isn't a valid amount
 */
export function rupeesToPaise(input) {
  const text = String(input ?? '').replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/**
 * Turn "YYYY-MM-DD" (or a Date) into a local Date without a timezone shift.
 * @param {string|Date} value
 * @returns {Date|null}
 */
export function toLocalDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * Short date: "14 Nov 2026". Long date: "Saturday, 14 November 2026".
 * @param {string|Date} value
 * @param {{ long?: boolean }} [options]
 * @returns {string}
 */
export function formatDate(value, { long = false } = {}) {
  const date = toLocalDate(value);
  if (!date) return '';
  return (long ? DATE_LONG : DATE).format(date);
}

/**
 * Whole calendar days from `now` until `value` (0 = today, negative = past).
 * @param {string|Date} value
 * @param {Date} [now]
 * @returns {number|null}
 */
export function daysUntil(value, now = new Date()) {
  const date = toLocalDate(value);
  if (!date) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((target - today) / DAY_MS);
}

/**
 * Share of a target reached, as a 0–1 ratio (capped at 1).
 * @param {number} part
 * @param {number} whole
 * @returns {number}
 */
export function ratio(part, whole) {
  if (!whole || whole <= 0) return 0;
  return Math.min(1, Math.max(0, part / whole));
}

/**
 * "1 friend" / "8 friends".
 * @param {number} count
 * @param {string} one
 * @param {string} [many]
 * @returns {string}
 */
export function plural(count, one, many = one + 's') {
  return `${count.toLocaleString('en-IN')} ${count === 1 ? one : many}`;
}
