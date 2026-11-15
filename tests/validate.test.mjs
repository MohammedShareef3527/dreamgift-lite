// Run with:  node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGift, looksLikeEmail, todayISO, UPI_PATTERN } from '../assets/js/validate.js';

const TODAY = '2026-11-15';
const good = {
  coupleNames: '  Ananya & Rohan ',
  weddingDate: '2026-12-12',
  giftTitle: 'Honeymoon dinner in Goa',
  giftStory: 'They met over biryani. ',
  target: '60,000',
  organiserName: 'Rahul',
  organiserUpi: ' Rahul.Mehta@OKHDFCBANK ',
  deadline: '',
  showAmounts: false,
};

test('a complete form becomes clean database columns', () => {
  const { data, errors } = validateGift(good, { today: TODAY });
  assert.deepEqual(errors, {});
  assert.deepEqual(data, {
    couple_names: 'Ananya & Rohan',
    wedding_date: '2026-12-12',
    gift_title: 'Honeymoon dinner in Goa',
    gift_story: 'They met over biryani.',
    target_paise: 6000000,
    organiser_name: 'Rahul',
    organiser_upi: 'rahul.mehta@okhdfcbank',
    deadline: null,
    show_amounts: false,
    razorpay_link: null,
  });
});

test('missing required fields each get their own message', () => {
  const { data, errors } = validateGift({}, { today: TODAY });
  assert.equal(data, null);
  assert.deepEqual(Object.keys(errors).sort(),
    ['coupleNames', 'giftTitle', 'organiserName', 'organiserUpi', 'target', 'weddingDate']);
});

test('lengths match the database limits (emoji count as one)', () => {
  const sixty = '😀'.repeat(60);
  assert.equal(validateGift({ ...good, coupleNames: sixty }, { today: TODAY }).errors.coupleNames, undefined);
  assert.ok(validateGift({ ...good, coupleNames: sixty + 'x' }, { today: TODAY }).errors.coupleNames);
  assert.ok(validateGift({ ...good, giftTitle: 'x'.repeat(81) }, { today: TODAY }).errors.giftTitle);
  assert.equal(validateGift({ ...good, giftStory: 'x'.repeat(500) }, { today: TODAY }).errors.giftStory, undefined);
  assert.ok(validateGift({ ...good, giftStory: 'x'.repeat(501) }, { today: TODAY }).errors.giftStory);
});

test('target must be a sensible rupee amount', () => {
  const t = (target) => validateGift({ ...good, target }, { today: TODAY }).errors.target;
  assert.equal(t('100'), undefined);
  assert.equal(t('₹1,00,00,000'), undefined);
  assert.ok(t('99'));
  assert.ok(t('1,00,00,001'));
  assert.ok(t('abc'));
  assert.ok(t('-500'));
  assert.ok(t(''));
});

test('UPI IDs follow the same rule as the database', () => {
  assert.equal(validateGift({ ...good, organiserUpi: 'rahul mehta@ybl' }, { today: TODAY }).data.organiser_upi, 'rahulmehta@ybl');
  for (const ok of ['name@okhdfcbank', 'a.b-c_d@ybl', '9876543210@paytm']) assert.ok(UPI_PATTERN.test(ok), ok);
  for (const bad of ['rahul', '@ybl', 'r@1bank', 'a@b', 'rahul@@ybl', 'x'.repeat(65) + '@ybl']) {
    assert.ok(validateGift({ ...good, organiserUpi: bad }, { today: TODAY }).errors.organiserUpi, bad);
  }
});

test('dates: real dates only, deadline not in the past unless unchanged', () => {
  const e = (fields, opts = {}) => validateGift({ ...good, ...fields }, { today: TODAY, ...opts }).errors;
  assert.ok(e({ weddingDate: '2026-02-30' }).weddingDate);
  assert.ok(e({ weddingDate: '12/12/2026' }).weddingDate);
  assert.equal(e({ deadline: TODAY }).deadline, undefined);
  assert.ok(e({ deadline: '2026-11-14' }).deadline);
  assert.equal(e({ deadline: '2026-11-01' }, { originalDeadline: '2026-11-01' }).deadline, undefined);
});

test('show amounts is only on when explicitly true', () => {
  assert.equal(validateGift({ ...good, showAmounts: 'on' }, { today: TODAY }).data.show_amounts, false);
  assert.equal(validateGift({ ...good, showAmounts: true }, { today: TODAY }).data.show_amounts, true);
});

test('email check and today helper', () => {
  assert.ok(looksLikeEmail('priya@gmail.com'));
  for (const bad of ['', 'priya', 'priya@', 'priya@gmail', 'a b@c.com']) assert.equal(looksLikeEmail(bad), false, bad);
  assert.equal(todayISO(new Date(2026, 0, 5)), '2026-01-05');
});

test('Razorpay link: optional, Razorpay domains over https only', () => {
  const r = (razorpayLink) => validateGift({ ...good, razorpayLink }, { today: TODAY });
  assert.equal(r('').data.razorpay_link, null);
  assert.equal(r(' https://razorpay.me/@rahulmehta/ ').data.razorpay_link, 'https://razorpay.me/@rahulmehta');
  for (const ok of ['https://rzp.io/l/abc123', 'https://pages.razorpay.com/pl_Abc/view']) assert.equal(r(ok).data.razorpay_link, ok);
  for (const bad of ['javascript:alert(1)', 'http://rzp.io/l/abc', 'https://razorpay.me.evil.com/@x', 'https://evil.com/razorpay.me', 'https://rzp.io/l/a?x=<b>', 'razorpay.me/@x']) {
    assert.ok(r(bad).errors.razorpayLink, bad);
  }
});
