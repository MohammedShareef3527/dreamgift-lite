/**
 * dashboard.js — the organiser's gifts (/dashboard) and one gift's
 * contributions, sharing and settings (/dashboard?gift={id}).
 */
import { requireUser, signOut } from '../supabase.js';
import {
  listMyGifts, getMyGift, listContributions, setContributionStatus, setBlessingHidden,
  addCashContribution, setGiftStatus, deleteGift, friendlyError, NotFoundError,
} from '../api.js';
import { formatRupees, formatDate, rupeesToPaise, ratio, plural, timeAgo, toCsv } from '../format.js';
import { LIMITS } from '../validate.js';
import { qrPng } from '../upi.js';
import {
  setProgress, toast, announce, setBusy, openSheet, closeSheet, showFieldError, clearFieldError, bindCounter, copyText,
} from '../ui.js';

const byId = (id) => document.getElementById(id);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFRESH_MS = 30_000;
const params = new URLSearchParams(location.search);
const giftId = params.get('gift');

const STATUS = {
  pledged: { label: 'Pledged', tone: 'pledged' },
  marked_paid: { label: 'Waiting', tone: 'waiting' },
  confirmed: { label: 'Confirmed', tone: 'confirmed' },
  rejected: { label: 'Rejected', tone: 'rejected' },
};

const EMPTY_TEXT = {
  all: 'No contributions yet. Share the link and they\'ll appear here 💛',
  marked_paid: 'Nothing waiting for you right now.',
  pledged: 'No unpaid pledges.',
  confirmed: 'Nothing confirmed yet.',
  rejected: 'Nothing rejected.',
};

// ===========================================================================
// All gifts
// ===========================================================================

/** @param {'loading'|'empty'|'error'|'list'} view */
function showList(view) {
  byId('loadingState').hidden = view !== 'loading';
  byId('emptyState').hidden = view !== 'empty';
  byId('errorState').hidden = view !== 'error';
  byId('giftList').hidden = view !== 'list';
}

/**
 * Build one gift card from the template. Every value goes in with textContent.
 * @param {object} gift
 * @returns {HTMLLIElement}
 */
function renderGiftCard(gift) {
  const card = byId('giftCardTemplate').content.firstElementChild.cloneNode(true);
  const field = (name) => card.querySelector(`[data-field="${name}"]`);
  const closed = gift.status === 'closed';

  field('for').textContent = `For ${gift.couple_names} · ${formatDate(gift.wedding_date)}`;
  field('title').textContent = gift.gift_title;
  field('raised').textContent = formatRupees(gift.confirmed_paise);
  field('target').textContent = `confirmed of ${formatRupees(gift.target_paise)}`;
  field('stats').textContent = gift.confirmed_count
    ? `${plural(gift.confirmed_count, 'payment')} confirmed`
    : 'No payments confirmed yet';

  if (gift.waiting_count) {
    const waiting = field('waiting');
    waiting.hidden = false;
    waiting.textContent = `${plural(gift.waiting_count, 'payment')} waiting for you`;
  }

  const badge = field('status');
  badge.textContent = closed ? 'Closed' : 'Live';
  badge.classList.add(closed ? 'badge--closed' : 'badge--confirmed');

  const bar = field('bar');
  bar.setAttribute('aria-label', `${gift.gift_title}: confirmed so far`);
  setProgress(bar, ratio(gift.confirmed_paise, gift.target_paise),
    `${formatRupees(gift.confirmed_paise)} of ${formatRupees(gift.target_paise)}`);

  const manage = field('manage');
  manage.href = `/dashboard?gift=${encodeURIComponent(gift.id)}`;
  manage.setAttribute('aria-label', `Manage ${gift.gift_title}`);
  const view = field('view');
  view.href = `/g/${encodeURIComponent(gift.slug)}`;
  view.setAttribute('aria-label', `View the gift page for ${gift.gift_title} (opens in a new tab)`);
  const edit = field('edit');
  edit.href = `/create?id=${encodeURIComponent(gift.id)}`;
  edit.setAttribute('aria-label', `Edit details of ${gift.gift_title}`);
  return card;
}

async function loadList() {
  showList('loading');
  try {
    const gifts = await listMyGifts();
    if (!gifts.length) return showList('empty');
    byId('giftList').replaceChildren(...gifts.map(renderGiftCard));
    showList('list');
  } catch (error) {
    byId('errorText').textContent = friendlyError(error);
    showList('error');
  }
}

// ===========================================================================
// One gift
// ===========================================================================

let gift = null;
let contributions = [];
let filter = 'all';
let lastDataKey = '';

/** @param {'loading'|'error'|'content'} view */
function showDetail(view) {
  byId('detailLoading').hidden = view !== 'loading';
  byId('detailError').hidden = view !== 'error';
  byId('detailContent').hidden = view !== 'content';
}

const shareUrl = () => `${location.origin}/g/${gift.slug}`;

function renderGiftHeader() {
  const closed = gift.status === 'closed';
  document.title = `${gift.gift_title} · DreamGift Lite`;
  byId('dFor').textContent = `For ${gift.couple_names} · ${formatDate(gift.wedding_date)}`;
  byId('dTitle').textContent = gift.gift_title;
  const badge = byId('dStatus');
  badge.textContent = closed ? 'Closed' : 'Live';
  badge.className = `badge ${closed ? 'badge--closed' : 'badge--confirmed'}`;

  const url = shareUrl();
  byId('shareLink').textContent = url;
  byId('viewPage').href = url;
  const message = `Hi everyone! 💛 We're pooling for a wedding gift for ${gift.couple_names}: ${gift.gift_title}. `
    + `Chip in by UPI and leave your blessing here: ${url}`;
  byId('whatsappLink').href = `https://wa.me/?text=${encodeURIComponent(message)}`;
  byId('editLink').href = `/create?id=${encodeURIComponent(gift.id)}`;

  byId('toggleClosed').textContent = closed ? 'Reopen gift' : 'Close gift';
  byId('closeHint').textContent = closed
    ? 'This gift is closed to new pledges. You can reopen it any time.'
    : 'Closing stops new pledges. Friends can still see the page and mark earlier pledges as paid.';
}

/** Sum and count contributions by status. */
function tallies() {
  const t = { all: { n: 0, paise: 0 } };
  for (const key of Object.keys(STATUS)) t[key] = { n: 0, paise: 0 };
  for (const c of contributions) {
    t[c.status].n += 1;
    t[c.status].paise += Number(c.amount_paise);
    t.all.n += 1;
  }
  return t;
}

function renderSummary() {
  const t = tallies();
  const confirmed = t.confirmed.paise;
  byId('dRaised').textContent = formatRupees(confirmed);
  byId('dTarget').textContent = `confirmed of ${formatRupees(gift.target_paise)}`;
  setProgress(byId('dBar'), ratio(confirmed, gift.target_paise), `${formatRupees(confirmed)} of ${formatRupees(gift.target_paise)}`);
  byId('tConfirmed').textContent = `${formatRupees(confirmed)} · ${t.confirmed.n}`;
  byId('tWaiting').textContent = `${formatRupees(t.marked_paid.paise)} · ${t.marked_paid.n}`;
  byId('tPledged').textContent = `${formatRupees(t.pledged.paise)} · ${t.pledged.n}`;
  for (const el of document.querySelectorAll('[data-count]')) el.textContent = String(t[el.dataset.count].n);
}

/** The buttons a row offers for its current status. */
function rowActions(c) {
  const who = `${c.contributor_name}, ${formatRupees(c.amount_paise)}`;
  switch (c.status) {
    case 'marked_paid':
    case 'pledged':
      return [
        { label: 'Confirm', to: 'confirmed', style: 'primary', aria: `Confirm ${who}` },
        { label: 'Reject', to: 'rejected', style: 'ghost', aria: `Reject ${who}` },
      ];
    case 'confirmed':
      return [{ label: 'Undo', to: c.source === 'cash' ? 'rejected' : 'marked_paid', style: 'ghost', aria: `Undo confirmation of ${who}` }];
    default:
      return [{ label: 'Confirm', to: 'confirmed', style: 'secondary', aria: `Confirm ${who}` }];
  }
}

/** @param {object} c a contribution row */
function renderRow(c) {
  const row = byId('rowTemplate').content.firstElementChild.cloneNode(true);
  const field = (name) => row.querySelector(`[data-field="${name}"]`);
  row.dataset.id = c.id;

  field('name').textContent = c.contributor_name;
  field('meta').textContent = [
    c.source === 'cash' ? 'Cash' : 'UPI',
    c.show_name ? null : 'Name hidden publicly',
    timeAgo(c.created_at),
  ].filter(Boolean).join(' · ');
  field('amount').textContent = formatRupees(c.amount_paise);

  const view = STATUS[c.status];
  const badge = field('badge');
  badge.textContent = view.label;
  badge.classList.add(`badge--${view.tone}`);

  const blessing = field('blessing');
  const hide = row.querySelector('[data-action="hide"]');
  if (c.blessing.trim()) {
    blessing.textContent = c.blessing;
    blessing.classList.toggle('contrib__blessing--hidden', c.blessing_hidden);
    hide.hidden = false;
    hide.textContent = c.blessing_hidden ? 'Show on wall' : 'Hide from wall';
    hide.setAttribute('aria-label', `${c.blessing_hidden ? 'Show' : 'Hide'} ${c.contributor_name}'s blessing ${c.blessing_hidden ? 'on' : 'from'} the public wall`);
    hide.addEventListener('click', () => toggleBlessing(c, hide));
  } else {
    blessing.textContent = 'No blessing';
    blessing.classList.add('contrib__blessing--none');
  }

  const actions = field('actions');
  for (const a of rowActions(c)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn btn--${a.style} btn--sm`;
    button.textContent = a.label;
    button.setAttribute('aria-label', a.aria);
    button.addEventListener('click', () => changeStatus(c, a.to, button));
    actions.append(button);
  }
  return row;
}

/** @param {{ focusId?: string }} [options] keep keyboard focus on a row after re-rendering */
function renderContributions({ focusId } = {}) {
  const rows = contributions.filter((c) => filter === 'all' || c.status === filter);
  byId('contribRows').replaceChildren(...rows.map(renderRow));
  byId('contribTableWrap').hidden = !rows.length;
  byId('contribEmpty').hidden = rows.length > 0;
  byId('contribEmptyText').textContent = EMPTY_TEXT[filter];
  byId('contribCaption').textContent = `Contributions to ${gift.gift_title}${filter === 'all' ? '' : `, ${STATUS[filter].label.toLowerCase()} only`}`;
  for (const b of document.querySelectorAll('[data-filter]')) b.setAttribute('aria-pressed', String(b.dataset.filter === filter));
  renderSummary();

  if (focusId) {
    const target = byId('contribRows').querySelector(`tr[data-id="${focusId}"] .table__actions .btn`);
    (target || document.querySelector(`[data-filter="${filter}"]`)).focus();
  }
}

/** Replace one contribution in local state with the saved row. */
function replaceContribution(updated) {
  contributions = contributions.map((c) => (c.id === updated.id ? updated : c));
  lastDataKey = JSON.stringify(contributions);
}

async function changeStatus(c, status, button) {
  setBusy(button, true, 'Saving…');
  try {
    replaceContribution(await setContributionStatus(c.id, status));
    renderContributions({ focusId: c.id });
    const amount = formatRupees(c.amount_paise);
    const message = {
      confirmed: `Confirmed ${amount} from ${c.contributor_name} ✨`,
      rejected: `Marked ${c.contributor_name}'s ${amount} as not received`,
      marked_paid: `${c.contributor_name}'s ${amount} is waiting again`,
    }[status];
    toast(message, { tone: status === 'confirmed' ? 'success' : 'info' });
  } catch (error) {
    setBusy(button, false);
    toast(friendlyError(error), { tone: 'error' });
  }
}

async function toggleBlessing(c, button) {
  setBusy(button, true, 'Saving…');
  try {
    const updated = await setBlessingHidden(c.id, !c.blessing_hidden);
    replaceContribution(updated);
    renderContributions();
    const again = byId('contribRows').querySelector(`tr[data-id="${c.id}"] [data-action="hide"]`);
    if (again) again.focus();
    toast(updated.blessing_hidden ? 'Blessing hidden from the public wall' : 'Blessing is back on the wall');
  } catch (error) {
    setBusy(button, false);
    toast(friendlyError(error), { tone: 'error' });
  }
}

// ---------- Share ----------

async function onCopyLink() {
  const ok = await copyText(shareUrl());
  toast(ok ? 'Link copied. Paste it in your WhatsApp group.' : 'Couldn\'t copy. Press and hold the link to copy it.', { tone: ok ? 'success' : 'error' });
}

/** @param {Blob} blob @param {string} filename */
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function onDownloadQr() {
  const button = byId('downloadQr');
  setBusy(button, true, 'Making your QR…');
  try {
    download(await qrPng(shareUrl(), `Chip in for ${gift.couple_names}`), `dreamgift-${gift.slug}-qr.png`);
    toast('QR code downloaded', { tone: 'success' });
  } catch {
    toast('Couldn\'t make the QR code. Please try again.', { tone: 'error' });
  } finally {
    setBusy(button, false);
  }
}

/** "2026-11-15 14:05" in the organiser's own timezone. */
function csvDate(value) {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function onExportCsv() {
  const header = ['Name', 'Amount (₹)', 'Status', 'Paid by', 'Blessing', 'Blessing hidden', 'Name shown publicly', 'Pledged on', 'Confirmed on'];
  const rows = contributions.map((c) => [
    c.contributor_name,
    (Number(c.amount_paise) / 100).toFixed(2),
    STATUS[c.status].label,
    c.source === 'cash' ? 'Cash' : 'UPI',
    c.blessing,
    c.blessing_hidden ? 'Yes' : 'No',
    c.show_name ? 'Yes' : 'No',
    csvDate(c.created_at),
    csvDate(c.confirmed_at),
  ]);
  // The BOM makes Excel read ₹ and non-English names correctly.
  const blob = new Blob([`﻿${toCsv([header, ...rows])}\r\n`], { type: 'text/csv;charset=utf-8' });
  download(blob, `dreamgift-${gift.slug}-contributions.csv`);
  toast(`Exported ${plural(rows.length, 'contribution')}`, { tone: 'success' });
}

// ---------- Cash ----------

function openCash() {
  byId('cashError').hidden = true;
  openSheet(byId('cashSheet'), { initialFocus: byId('cashName') });
}

/** @param {SubmitEvent} event */
async function onCashSubmit(event) {
  event.preventDefault();
  byId('cashError').hidden = true;
  const nameInput = byId('cashName');
  const amountInput = byId('cashAmount');
  const blessingInput = byId('cashBlessing');
  const name = nameInput.value.trim();
  const amountPaise = rupeesToPaise(amountInput.value);
  const blessing = blessingInput.value.trim();
  let first = null;

  if (!name) { showFieldError(nameInput, 'Add the friend\'s name.'); first ??= nameInput; } else clearFieldError(nameInput);
  if (amountPaise === null || amountPaise < 10_00 || amountPaise > 1_00_000_00) {
    showFieldError(amountInput, amountPaise === null ? 'Enter an amount in rupees, like 2,000.' : 'Please enter between ₹10 and ₹1,00,000.');
    first ??= amountInput;
  } else clearFieldError(amountInput);
  if ([...blessing].length > LIMITS.blessing) {
    showFieldError(blessingInput, `Please keep the blessing under ${LIMITS.blessing} characters.`);
    first ??= blessingInput;
  } else clearFieldError(blessingInput);
  if (first) return first.focus();

  const button = byId('cashSubmit');
  setBusy(button, true, 'Adding…');
  try {
    const row = await addCashContribution(gift.id, { name, amountPaise, blessing, showName: byId('cashShowName').checked });
    contributions = [row, ...contributions];
    lastDataKey = JSON.stringify(contributions);
    byId('cashForm').reset();
    blessingInput.dispatchEvent(new Event('input'));
    closeSheet(byId('cashSheet'));
    renderContributions();
    toast(`Added ${formatRupees(amountPaise)} from ${name} ✨`, { tone: 'success' });
  } catch (error) {
    byId('cashErrorText').textContent = friendlyError(error);
    byId('cashError').hidden = false;
  } finally {
    setBusy(button, false);
  }
}

// ---------- Close / delete ----------

async function onToggleClosed() {
  const button = byId('toggleClosed');
  const next = gift.status === 'closed' ? 'active' : 'closed';
  setBusy(button, true, next === 'closed' ? 'Closing…' : 'Reopening…');
  try {
    gift = await setGiftStatus(gift.id, next);
    setBusy(button, false);
    renderGiftHeader();
    button.focus();
    toast(next === 'closed' ? 'Gift closed to new pledges' : 'Gift reopened', { tone: 'success' });
  } catch (error) {
    setBusy(button, false);
    toast(friendlyError(error), { tone: 'error' });
  }
}

function openDelete() {
  const n = contributions.length;
  byId('deleteText').textContent = `"${gift.gift_title}" and ${n ? `its ${plural(n, 'contribution')} and blessings` : 'its page'} will be removed for good. This can't be undone.`;
  byId('deleteError').hidden = true;
  openSheet(byId('deleteSheet'));
}

async function onConfirmDelete() {
  const button = byId('confirmDelete');
  setBusy(button, true, 'Deleting…');
  try {
    await deleteGift(gift.id);
    location.assign('/dashboard?deleted=1');
  } catch (error) {
    setBusy(button, false);
    byId('deleteErrorText').textContent = friendlyError(error);
    byId('deleteError').hidden = false;
  }
}

// ---------- Load + refresh ----------

async function loadDetail() {
  showDetail('loading');
  if (!UUID.test(giftId || '')) return showDetailMissing();
  try {
    const [g, rows] = await Promise.all([getMyGift(giftId), listContributions(giftId)]);
    gift = g;
    contributions = rows;
    lastDataKey = JSON.stringify(rows);
    renderGiftHeader();
    renderContributions();
    showDetail('content');
    byId('dTitle').focus();
  } catch (error) {
    if (error instanceof NotFoundError) return showDetailMissing();
    byId('detailErrorTitle').textContent = 'We couldn\'t load this gift';
    byId('detailErrorText').textContent = friendlyError(error);
    byId('detailRetry').hidden = false;
    showDetail('error');
  }
}

function showDetailMissing() {
  byId('detailErrorTitle').textContent = 'We couldn\'t find that gift';
  byId('detailErrorText').textContent = 'It may have been deleted, or it belongs to a different account.';
  byId('detailRetry').hidden = true;
  showDetail('error');
}

/** Pick up new "I've paid" taps without disturbing what the organiser is doing. */
async function refreshContributions() {
  if (!gift || document.visibilityState !== 'visible' || document.querySelector('dialog[open], button[aria-busy="true"]')) return;
  try {
    const rows = await listContributions(gift.id);
    const key = JSON.stringify(rows);
    if (key === lastDataKey) return;
    const before = new Set(contributions.filter((c) => c.status === 'marked_paid').map((c) => c.id));
    contributions = rows;
    lastDataKey = key;
    const focusedRow = document.activeElement?.closest?.('tr[data-id]')?.dataset.id;
    renderContributions({ focusId: focusedRow });
    const fresh = rows.filter((c) => c.status === 'marked_paid' && !before.has(c.id)).length;
    if (fresh) announce(`${plural(fresh, 'new payment')} waiting for you to confirm.`);
  } catch {
    // try again on the next tick
  }
}

function wireDetail() {
  for (const b of document.querySelectorAll('[data-filter]')) {
    b.addEventListener('click', () => {
      filter = b.dataset.filter;
      renderContributions();
    });
  }
  byId('copyLink').addEventListener('click', onCopyLink);
  byId('downloadQr').addEventListener('click', onDownloadQr);
  byId('exportCsv').addEventListener('click', onExportCsv);
  byId('addCash').addEventListener('click', openCash);
  byId('cashForm').addEventListener('submit', onCashSubmit);
  bindCounter(byId('cashBlessing'), byId('cashBlessingCount'), LIMITS.blessing);
  byId('toggleClosed').addEventListener('click', onToggleClosed);
  byId('deleteGift').addEventListener('click', openDelete);
  byId('confirmDelete').addEventListener('click', onConfirmDelete);
  byId('detailRetry').addEventListener('click', loadDetail);
  window.setInterval(refreshContributions, REFRESH_MS);
  document.addEventListener('visibilitychange', refreshContributions);
}

// ===========================================================================
// Start
// ===========================================================================

/** Say what just happened once, then tidy the address bar. */
function confirmArrival() {
  if (params.has('created')) toast('Your gift page is ready ✨', { tone: 'success' });
  else if (params.has('saved')) toast('Changes saved', { tone: 'success' });
  else if (params.has('deleted')) toast('Gift page deleted');
  const keep = giftId ? `?gift=${encodeURIComponent(giftId)}` : '';
  if (params.has('created') || params.has('saved') || params.has('deleted') || location.hash) {
    history.replaceState(null, '', `${location.pathname}${keep}`);
  }
}

async function init() {
  byId('signOut').addEventListener('click', () => signOut());
  byId('retryButton').addEventListener('click', loadList);
  showList('loading');

  const user = await requireUser();
  if (!user) return;
  byId('whoAmI').textContent = `Signed in as ${user.email}`;

  if (giftId !== null) {
    byId('listView').hidden = true;
    byId('detailView').hidden = false;
    wireDetail();
    await loadDetail();
  } else {
    await loadList();
  }
  confirmArrival();
}

init();
