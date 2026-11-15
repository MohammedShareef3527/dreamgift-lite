/**
 * g.js — the public gift page at /g/{slug}. No login: everything goes through
 * the public database functions. Pledges are remembered on this device.
 */
import {
  getPublicGift, getPublicBlessings, createPledge, markPaid, getMyPledge, pledgeErrorMessage, friendlyError,
} from '../api.js';
import { savedPledges, savePledge, forgetPledge } from '../pledges.js';
import { buildUpiLink, canOpenUpiLink, renderQr } from '../upi.js';
import { formatRupees, rupeesToPaise, formatDate, daysUntil, ratio, plural, timeAgo } from '../format.js';
import { LIMITS } from '../validate.js';
import {
  toast, announce, setBusy, openSheet, setProgress, showFieldError, clearFieldError, bindCounter, copyText,
} from '../ui.js';

const REFRESH_MS = 20_000;
const MIN_PAISE = 10_00;
const MAX_PAISE = 1_00_000_00;
const byId = (id) => document.getElementById(id);

const slug = (/^\/g\/([a-z0-9]{8})\/?$/i.exec(location.pathname)?.[1] || '').toLowerCase();

let gift = null;
let lastBlessingsKey = '';
const pledgeStatus = new Map(); // id → last status seen, to notice confirmations
let activePledge = null;        // the pledge the sheet is showing
let refreshTimer = 0;

// ---------------------------------------------------------------------------
// Page states
// ---------------------------------------------------------------------------

/** @param {'loading'|'problem'|'gift'} view */
function show(view) {
  byId('loadingState').hidden = view !== 'loading';
  byId('problemState').hidden = view !== 'problem';
  byId('giftView').hidden = view !== 'gift';
}

function showNotFound() {
  document.title = 'Gift page not found · DreamGift Lite';
  byId('problemIcon').setAttribute('href', '#i-gift');
  byId('problemCard').classList.remove('state--error');
  byId('problemTitle').textContent = 'We couldn\'t find this gift page';
  byId('problemText').textContent = 'The link may be incomplete, or the page may have been removed. Please check the link with whoever shared it.';
  byId('retryButton').hidden = true;
  show('problem');
}

function showLoadError(error) {
  byId('problemIcon').setAttribute('href', '#i-cloud-off');
  byId('problemCard').classList.add('state--error');
  byId('problemTitle').textContent = 'We couldn\'t load this gift page';
  byId('problemText').textContent = friendlyError(error);
  byId('retryButton').hidden = false;
  show('problem');
}

// ---------------------------------------------------------------------------
// Gift + progress
// ---------------------------------------------------------------------------

/** @param {object} g a row from get_public_gift */
function renderGift(g) {
  const organiser = g.organiser_name;
  document.title = `${g.gift_title} for ${g.couple_names} · DreamGift Lite`;
  byId('coupleNames').textContent = g.couple_names;
  byId('weddingDate').textContent = formatDate(g.wedding_date, { long: true });
  byId('giftTitle').textContent = g.gift_title;
  byId('giftStory').textContent = g.gift_story || '';
  for (const el of document.querySelectorAll('[data-organiser]')) el.textContent = organiser;

  const confirmed = Number(g.confirmed_paise);
  const target = Number(g.target_paise);
  byId('raised').textContent = formatRupees(confirmed);
  byId('target').textContent = `raised of ${formatRupees(target)}`;
  setProgress(byId('progressBar'), ratio(confirmed, target), `${formatRupees(confirmed)} of ${formatRupees(target)}`);

  const count = Number(g.contributor_count);
  byId('friendsStat').textContent = count ? `${plural(count, 'friend')} chipped in` : 'Be the first to chip in';
  byId('daysStat').textContent = daysText(g, confirmed >= target);

  const trust = `Payments go directly to ${organiser}'s UPI. DreamGift Lite never holds your money.`;
  byId('trustText').textContent = trust;
  byId('payTrustText').textContent = `${trust} Nothing counts as paid until ${organiser} confirms it.`;

  byId('chipInButton').hidden = !g.is_open;
  byId('closedNotice').hidden = g.is_open;
  if (!g.is_open) {
    byId('closedText').textContent = g.status === 'closed'
      ? 'This gift is closed. Thank you to everyone who chipped in 💛'
      : 'The deadline for this gift has passed. Thank you to everyone who chipped in 💛';
  }
  updateChipBar();
}

/** "12 days left", "Last day today", or a celebration once the target is met. */
function daysText(g, reached) {
  if (reached) return 'Target reached. You made their day ✨';
  if (!g.deadline) return '';
  const days = daysUntil(g.deadline);
  if (days === null || days < 0) return 'Deadline passed';
  if (days === 0) return 'Last day today';
  return `${plural(days, 'day')} left`;
}

// ---------------------------------------------------------------------------
// Blessings wall
// ---------------------------------------------------------------------------

/** @param {Array<object>} blessings */
function renderBlessings(blessings) {
  const key = JSON.stringify(blessings);
  if (key === lastBlessingsKey) return; // unchanged: don't disturb screen readers
  lastBlessingsKey = key;

  const template = byId('blessingTemplate').content.firstElementChild;
  const items = blessings.map((b) => {
    const li = template.cloneNode(true);
    li.querySelector('[data-field="text"]').textContent = b.blessing;
    li.querySelector('[data-field="name"]').textContent = b.name;
    li.querySelector('[data-field="amount"]').textContent = b.amount_paise ? formatRupees(b.amount_paise) : '';
    const when = li.querySelector('[data-field="when"]');
    when.textContent = timeAgo(b.created_at);
    return li;
  });
  byId('blessingsList').replaceChildren(...items);
  byId('blessingsList').hidden = !items.length;
  byId('blessingsEmpty').hidden = items.length > 0;
}

// ---------------------------------------------------------------------------
// Pledges made on this device
// ---------------------------------------------------------------------------

const STATUS_VIEW = {
  pledged: { badge: 'Not paid yet', tone: 'pledged' },
  marked_paid: { badge: 'Waiting', tone: 'waiting' },
  confirmed: { badge: 'Confirmed', tone: 'confirmed' },
  rejected: { badge: 'Not received', tone: 'rejected' },
};

function pledgeText(status, amount) {
  const organiser = gift.organiser_name;
  switch (status) {
    case 'pledged': return `Pay ${amount} to ${organiser}'s UPI, then tap "I've paid".`;
    case 'marked_paid': return `Waiting for ${organiser} to confirm.`;
    case 'confirmed': return 'Confirmed — thank you! 💛';
    default: return `${organiser} couldn't find this payment. Please check with them.`;
  }
}

async function refreshMyPledges() {
  const saved = savedPledges(slug);
  if (!saved.length) {
    byId('myPledges').hidden = true;
    return;
  }

  const results = await Promise.all(saved.slice(0, 5).map(async (p) => {
    try {
      const live = await getMyPledge(p.id, p.token);
      if (!live) forgetPledge(slug, p.id); // removed by the organiser
      return live ? { ...p, status: live.status, amountPaise: live.amount_paise } : null;
    } catch {
      return { ...p, status: pledgeStatus.get(p.id) || null }; // offline: keep what we knew
    }
  }));
  const pledges = results.filter((p) => p && p.status);

  const template = byId('pledgeTemplate').content.firstElementChild;
  const items = pledges.map((p) => {
    const before = pledgeStatus.get(p.id);
    if (before && before !== p.status && p.status === 'confirmed') toast('Confirmed — thank you! 💛', { tone: 'success' });
    pledgeStatus.set(p.id, p.status);

    const view = STATUS_VIEW[p.status] || STATUS_VIEW.pledged;
    const amount = formatRupees(p.amountPaise);
    const li = template.cloneNode(true);
    li.classList.add(`pledge--${view.tone}`);
    li.querySelector('[data-field="amount"]').textContent = amount;
    const badge = li.querySelector('[data-field="badge"]');
    badge.textContent = view.badge;
    badge.classList.add(`badge--${view.tone}`);
    li.querySelector('[data-field="text"]').textContent = pledgeText(p.status, amount);

    if (p.status === 'pledged') {
      li.querySelector('[data-field="actions"]').hidden = false;
      const pay = li.querySelector('[data-action="pay"]');
      const paid = li.querySelector('[data-action="paid"]');
      pay.setAttribute('aria-label', `Pay ${amount} now`);
      paid.setAttribute('aria-label', `I've paid ${amount}`);
      pay.addEventListener('click', () => openPayFor(p));
      paid.addEventListener('click', () => confirmPaidFromCard(p, paid));
    }
    return li;
  });

  byId('myPledgesList').replaceChildren(...items);
  byId('myPledges').hidden = !items.length;
  byId('myPledgesTitle').textContent = items.length > 1 ? 'Your pledges' : 'Your pledge';
}

async function confirmPaidFromCard(pledge, button) {
  setBusy(button, true, 'Saving…');
  try {
    await markPaid(pledge.id, pledge.token);
    toast(`Thank you! Waiting for ${gift.organiser_name} to confirm.`, { tone: 'success' });
    await Promise.all([refreshMyPledges(), refreshBlessings()]);
  } catch (error) {
    setBusy(button, false);
    toast(pledgeErrorMessage(error), { tone: 'error' });
  }
}

// ---------------------------------------------------------------------------
// Chip-in sheet
// ---------------------------------------------------------------------------

/** @param {'details'|'pay'|'done'} step */
function showStep(step) {
  byId('detailsStep').hidden = step !== 'details';
  byId('payStep').hidden = step !== 'pay';
  byId('doneStep').hidden = step !== 'done';
  byId('sheetTitle').textContent = {
    details: `Chip in for ${gift.couple_names}`,
    pay: `Pay ${gift.organiser_name}`,
    done: 'Thank you 💛',
  }[step];
}

/** The amount picked in the sheet, in paise, or null if the custom amount is invalid. */
function selectedAmount() {
  const choice = document.querySelector('input[name="amount"]:checked')?.value;
  if (choice && choice !== 'custom') return Number(choice);
  return rupeesToPaise(byId('customAmount').value);
}

function updateContinueLabel() {
  const custom = byId('customChip').checked;
  byId('customAmountField').hidden = !custom;
  const paise = selectedAmount();
  const valid = paise !== null && paise >= MIN_PAISE && paise <= MAX_PAISE;
  byId('continueButton').textContent = valid ? `Continue to pay ${formatRupees(paise)}` : 'Continue to pay';
}

function openChipIn() {
  if (!gift?.is_open) return;
  showStep('details');
  byId('detailsError').hidden = true;
  if (!byId('friendName').value) {
    const last = savedPledges(slug)[0];
    if (last?.name) byId('friendName').value = last.name;
  }
  updateContinueLabel();
  openSheet(byId('chipSheet'), { initialFocus: byId('friendName') });
}

/** @param {SubmitEvent} event */
async function onDetailsSubmit(event) {
  event.preventDefault();
  byId('detailsError').hidden = true;

  const nameInput = byId('friendName');
  const name = nameInput.value.trim();
  const blessing = byId('blessing').value.trim();
  const amountPaise = selectedAmount();
  let firstInvalid = null;

  if (!name) { showFieldError(nameInput, 'Please add your name.'); firstInvalid ??= nameInput; }
  else if ([...name].length > LIMITS.name) { showFieldError(nameInput, `Please keep your name under ${LIMITS.name} characters.`); firstInvalid ??= nameInput; }
  else clearFieldError(nameInput);

  const custom = byId('customAmount');
  if (amountPaise === null || amountPaise < MIN_PAISE || amountPaise > MAX_PAISE) {
    const message = amountPaise === null ? 'Enter an amount in rupees, like 1,500.' : 'Please choose between ₹10 and ₹1,00,000.';
    showFieldError(custom, message);
    firstInvalid ??= custom;
  } else clearFieldError(custom);

  if ([...blessing].length > LIMITS.blessing) {
    showFieldError(byId('blessing'), `Please keep your blessing under ${LIMITS.blessing} characters.`);
    firstInvalid ??= byId('blessing');
  } else clearFieldError(byId('blessing'));

  if (firstInvalid) {
    firstInvalid.focus();
    return;
  }

  const button = byId('continueButton');
  setBusy(button, true, 'Saving your pledge…');
  try {
    const result = await createPledge(slug, { name, amountPaise, blessing, showName: byId('showName').checked });
    const pledge = { id: result.contribution_id, token: result.edit_token, amountPaise, name, createdAt: new Date().toISOString() };
    pledgeStatus.set(pledge.id, 'pledged');
    if (!savePledge(slug, pledge)) {
      toast('Your browser won\'t remember this pledge, so tap "I\'ve paid" before you leave.', { duration: 7000 });
    }
    byId('detailsStep').reset();
    byId('friendName').value = name;
    await showPayStep(pledge);
    refreshMyPledges();
  } catch (error) {
    byId('detailsErrorText').textContent = pledgeErrorMessage(error);
    byId('detailsError').hidden = false;
    if (['GIFT_CLOSED', 'DEADLINE_PASSED', 'GIFT_NOT_FOUND'].includes(error?.message)) refresh();
  } finally {
    setBusy(button, false);
    updateContinueLabel();
  }
}

/** @param {{ id: string, token: string, amountPaise: number }} pledge */
async function showPayStep(pledge) {
  activePledge = pledge;
  const amount = formatRupees(pledge.amountPaise);
  const link = buildUpiLink({
    upi: gift.organiser_upi,
    name: gift.organiser_name,
    amountPaise: pledge.amountPaise,
    note: `Gift for ${gift.couple_names}`,
  });

  byId('payAmount').textContent = amount;
  byId('payAmountHint').textContent = amount;
  byId('upiValue').textContent = gift.organiser_upi;
  byId('payError').hidden = true;

  const deepLink = canOpenUpiLink();
  const upiLink = byId('upiLink');
  upiLink.hidden = !deepLink;
  upiLink.href = link;
  upiLink.textContent = `Pay ${amount} with UPI`;
  byId('showQrButton').hidden = !deepLink;
  byId('qrBlock').hidden = deepLink;
  byId('qrCode').replaceChildren();
  showStep('pay');
  byId('sheetTitle').focus();
  announce(`Pledge saved. Now pay ${amount} to ${gift.organiser_name}.`);
  if (!deepLink) await drawQr(link, amount);
}

async function drawQr(link, amount) {
  try {
    await renderQr(byId('qrCode'), link, `QR code to pay ${amount} to ${gift.organiser_name} by UPI`);
  } catch {
    byId('qrBlock').hidden = true; // the UPI ID + amount below still work
  }
}

/** Re-open the sheet on the pay step for a pledge saved earlier. */
async function openPayFor(pledge) {
  openSheet(byId('chipSheet'));
  await showPayStep(pledge);
}

async function onPaid() {
  if (!activePledge) return;
  const button = byId('paidButton');
  setBusy(button, true, 'Letting them know…');
  try {
    const status = await markPaid(activePledge.id, activePledge.token);
    pledgeStatus.set(activePledge.id, status);
    const organiser = gift.organiser_name;
    const confirmed = status === 'confirmed';
    byId('doneTitle').textContent = confirmed ? 'Confirmed — thank you!' : `Waiting for ${organiser} to confirm`;
    byId('doneText').textContent = confirmed
      ? `${organiser} has already confirmed your payment.`
      : `We've let ${organiser} know. Once they see your payment, this page will show it as confirmed.`;
    showStep('done');
    byId('sheetTitle').focus();
    announce(byId('doneTitle').textContent);
    refreshMyPledges();
    refreshBlessings();
  } catch (error) {
    byId('payErrorText').textContent = pledgeErrorMessage(error);
    byId('payError').hidden = false;
  } finally {
    setBusy(button, false);
  }
}

// ---------------------------------------------------------------------------
// Sticky bar, refresh loop, start-up
// ---------------------------------------------------------------------------

let mainButtonVisible = true;

function updateChipBar() {
  const show = Boolean(gift?.is_open) && !mainButtonVisible && !byId('chipSheet').open;
  byId('chipBar').hidden = !show;
  document.body.classList.toggle('has-chip-bar', show);
}

async function refreshBlessings() {
  try {
    renderBlessings(await getPublicBlessings(slug));
  } catch {
    // keep the wall as it is; the next refresh will try again
  }
}

async function refresh() {
  try {
    const latest = await getPublicGift(slug);
    if (!latest) return showNotFound();
    gift = latest;
    renderGift(gift);
  } catch {
    return; // offline for a moment: keep showing what we have
  }
  await Promise.all([refreshBlessings(), refreshMyPledges()]);
}

function startRefreshing() {
  window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') refresh();
  }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
}

async function load() {
  show('loading');
  if (!slug) return showNotFound();
  try {
    const [g, blessings] = await Promise.all([getPublicGift(slug), getPublicBlessings(slug)]);
    if (!g) return showNotFound();
    gift = g;
    renderGift(g);
    renderBlessings(blessings);
    show('gift');
    await refreshMyPledges();
    startRefreshing();
  } catch (error) {
    showLoadError(error);
  }
}

function init() {
  bindCounter(byId('blessing'), byId('blessingCount'), LIMITS.blessing);
  byId('chipInButton').addEventListener('click', openChipIn);
  byId('chipBarButton').addEventListener('click', openChipIn);
  byId('detailsStep').addEventListener('submit', onDetailsSubmit);
  byId('detailsStep').addEventListener('change', updateContinueLabel);
  byId('customAmount').addEventListener('input', () => {
    clearFieldError(byId('customAmount'));
    updateContinueLabel();
  });
  byId('friendName').addEventListener('input', () => clearFieldError(byId('friendName')));
  byId('customChip').addEventListener('change', () => {
    updateContinueLabel(); // reveal the field before focusing it
    if (byId('customChip').checked) byId('customAmount').focus();
  });
  byId('paidButton').addEventListener('click', onPaid);
  byId('showQrButton').addEventListener('click', async () => {
    byId('showQrButton').hidden = true;
    byId('qrBlock').hidden = false;
    await drawQr(byId('upiLink').href, formatRupees(activePledge.amountPaise));
  });
  byId('copyUpi').addEventListener('click', async () => {
    const ok = await copyText(gift.organiser_upi);
    toast(ok ? 'UPI ID copied' : 'Couldn\'t copy. Press and hold the UPI ID to copy it.', { tone: ok ? 'success' : 'error' });
  });
  byId('retryButton').addEventListener('click', load);

  const sheet = byId('chipSheet');
  sheet.addEventListener('close', () => {
    activePledge = null;
    updateChipBar();
  });
  // openSheet() doesn't emit an event, so watch the open attribute instead.
  new MutationObserver(updateChipBar).observe(sheet, { attributes: true, attributeFilter: ['open'] });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      mainButtonVisible = entry.isIntersecting || entry.boundingClientRect.top > 0;
      updateChipBar();
    }).observe(byId('chipInButton'));
  }

  load();
}

init();

