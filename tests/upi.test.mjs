// Run with:  node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUpiLink, upiAmount, canOpenUpiLink } from '../assets/js/upi.js';
import { timeAgo } from '../assets/js/format.js';

test('upiAmount writes rupees with two decimals', () => {
  assert.equal(upiAmount(50000), '500.00');
  assert.equal(upiAmount(50050), '500.50');
  assert.equal(upiAmount(1005), '10.05');
  assert.equal(upiAmount(10000000), '100000.00');
});

test('buildUpiLink has every field the brief asks for, safely encoded', () => {
  const link = buildUpiLink({ upi: ' rahul@okhdfcbank ', name: 'Rahul & Co', amountPaise: 100000, note: 'Gift for Ananya & Rohan' });
  assert.ok(link.startsWith('upi://pay?'));
  const params = new URLSearchParams(link.slice('upi://pay?'.length));
  assert.equal(params.get('pa'), 'rahul@okhdfcbank');
  assert.equal(params.get('pn'), 'Rahul & Co');
  assert.equal(params.get('am'), '1000.00');
  assert.equal(params.get('cu'), 'INR');
  assert.equal(params.get('tn'), 'Gift for Ananya & Rohan');
  assert.ok(!link.includes('+'), 'spaces are %20, not +');
  assert.ok(!/[ &]Co/.test(link.split('?')[1].replace(/&(pa|pn|am|cu|tn)=/g, '')), 'ampersands inside values are encoded');
});

test('long notes are trimmed and empty notes are left out', () => {
  const long = buildUpiLink({ upi: 'a@ybl', name: 'A', amountPaise: 1000, note: 'x'.repeat(80) });
  assert.equal(new URLSearchParams(long.split('?')[1]).get('tn').length, 40);
  const none = buildUpiLink({ upi: 'a@ybl', name: 'A', amountPaise: 1000 });
  assert.equal(new URLSearchParams(none.split('?')[1]).has('tn'), false);
});

test('only Android gets the deep link', () => {
  assert.equal(canOpenUpiLink('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/131'), true);
  assert.equal(canOpenUpiLink('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari'), false);
  assert.equal(canOpenUpiLink('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131'), false);
});

test('timeAgo reads naturally', () => {
  const now = new Date('2026-11-15T12:00:00Z');
  assert.equal(timeAgo('2026-11-15T11:59:30Z', now), 'just now');
  assert.equal(timeAgo('2026-11-15T11:55:00Z', now), '5 minutes ago');
  assert.equal(timeAgo('2026-11-14T10:00:00Z', now), 'yesterday');
  assert.equal(timeAgo('2026-11-12T12:00:00Z', now), '3 days ago');
  assert.equal(timeAgo('2026-10-01T12:00:00Z', now), '1 Oct 2026');
  assert.equal(timeAgo('not a date', now), '');
});
