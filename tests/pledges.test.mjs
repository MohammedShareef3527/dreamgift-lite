// Run with:  node --test tests/
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
const { savedPledges, savePledge, forgetPledge } = await import('../assets/js/pledges.js');

const pledge = (id) => ({ id, token: 't'.repeat(64), amountPaise: 100000, name: 'Priya', createdAt: '2026-11-15T10:00:00Z' });

beforeEach(() => store.clear());

test('pledges are remembered per gift, newest first', () => {
  savePledge('giftaaaa', pledge('1'));
  savePledge('giftaaaa', pledge('2'));
  savePledge('giftbbbb', pledge('3'));
  assert.deepEqual(savedPledges('giftaaaa').map((p) => p.id), ['2', '1']);
  assert.deepEqual(savedPledges('giftbbbb').map((p) => p.id), ['3']);
  assert.deepEqual(savedPledges('nothing1'), []);
});

test('saving the same pledge again does not duplicate it', () => {
  savePledge('giftaaaa', pledge('1'));
  savePledge('giftaaaa', pledge('1'));
  assert.equal(savedPledges('giftaaaa').length, 1);
});

test('forgetPledge removes one pledge', () => {
  savePledge('giftaaaa', pledge('1'));
  savePledge('giftaaaa', pledge('2'));
  forgetPledge('giftaaaa', '1');
  assert.deepEqual(savedPledges('giftaaaa').map((p) => p.id), ['2']);
});

test('corrupt or blocked storage never breaks the page', () => {
  store.set('dreamgift:pledges:v1', '{not json');
  assert.deepEqual(savedPledges('giftaaaa'), []);
  const original = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => { throw new Error('QuotaExceeded'); };
  assert.equal(savePledge('giftaaaa', pledge('1')), false);
  globalThis.localStorage.setItem = original;
});
