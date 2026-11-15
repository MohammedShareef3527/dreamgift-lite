// Run with:  node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRupees, rupeesToPaise, formatDate, daysUntil, ratio, plural } from '../assets/js/format.js';

test('formatRupees uses Indian grouping and hides zero paise', () => {
  assert.equal(formatRupees(50000), '₹500');
  assert.equal(formatRupees(10000000), '₹1,00,000');
  assert.equal(formatRupees(425000000), '₹42,50,000');
  assert.equal(formatRupees(50050), '₹500.50');
  assert.equal(formatRupees(0), '₹0');
});

test('rupeesToPaise parses what people type and rejects junk', () => {
  assert.equal(rupeesToPaise('1,000'), 100000);
  assert.equal(rupeesToPaise('₹ 500'), 50000);
  assert.equal(rupeesToPaise('500.5'), 50050);
  assert.equal(rupeesToPaise('500.55'), 50055);
  assert.equal(rupeesToPaise(2000), 200000);
  for (const bad of ['', 'abc', '-500', '500.555', '5e3', '1.2.3', null, undefined]) {
    assert.equal(rupeesToPaise(bad), null, `should reject ${bad}`);
  }
});

test('formatDate reads YYYY-MM-DD as a local date (no off-by-one)', () => {
  assert.equal(formatDate('2026-12-12'), '12 Dec 2026');
  assert.equal(formatDate('2026-01-01'), '1 Jan 2026');
  assert.equal(formatDate('2026-12-12', { long: true }), 'Saturday, 12 December 2026');
  assert.equal(formatDate('not a date'), '');
});

test('daysUntil counts calendar days', () => {
  const now = new Date(2026, 10, 14, 23, 30); // 14 Nov 2026, late evening
  assert.equal(daysUntil('2026-11-14', now), 0);
  assert.equal(daysUntil('2026-11-15', now), 1);
  assert.equal(daysUntil('2026-12-12', now), 28);
  assert.equal(daysUntil('2026-11-10', now), -4);
  assert.equal(daysUntil('', now), null);
});

test('ratio is clamped and safe with a zero target', () => {
  assert.equal(ratio(42000, 60000), 0.7);
  assert.equal(ratio(90000, 60000), 1);
  assert.equal(ratio(100, 0), 0);
});

test('plural', () => {
  assert.equal(plural(1, 'friend'), '1 friend');
  assert.equal(plural(8, 'friend'), '8 friends');
  assert.equal(plural(1200, 'friend'), '1,200 friends');
});

test('toCsv quotes, escapes and defuses formulas', async () => {
  const { toCsv } = await import('../assets/js/format.js');
  assert.equal(toCsv([['Name', 'Amount'], ['Priya', 1000]]), 'Name,Amount\r\nPriya,1000');
  assert.equal(toCsv([['A, B', 'say "hi"', 'line\nbreak']]), '"A, B","say ""hi""","line\nbreak"');
  assert.equal(toCsv([['=HYPERLINK("x")', '+91', '-1', '@sum', 'normal']]), '"\'=HYPERLINK(""x"")",\'+91,\'-1,\'@sum,normal');
  assert.equal(toCsv([[-500, null, undefined, true]]), '-500,,,true');
});
