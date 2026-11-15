/**
 * dashboard.js — the organiser's gift pages with confirmed progress.
 */
import { requireUser, signOut } from '../supabase.js';
import { listMyGifts, friendlyError } from '../api.js';
import { formatRupees, formatDate, ratio, plural } from '../format.js';
import { setProgress, toast } from '../ui.js';

const byId = (id) => document.getElementById(id);

/** @param {'loading'|'empty'|'error'|'list'} view */
function show(view) {
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
function renderGift(gift) {
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

  const badge = field('status');
  badge.textContent = closed ? 'Closed' : 'Live';
  badge.classList.add(closed ? 'badge--closed' : 'badge--confirmed');

  const bar = field('bar');
  bar.setAttribute('aria-label', `${gift.gift_title}: confirmed so far`);
  setProgress(bar, ratio(gift.confirmed_paise, gift.target_paise),
    `${formatRupees(gift.confirmed_paise)} of ${formatRupees(gift.target_paise)}`);

  const edit = field('edit');
  edit.href = `/create?id=${encodeURIComponent(gift.id)}`;
  edit.setAttribute('aria-label', `Edit details of ${gift.gift_title}`);
  return card;
}

async function load() {
  show('loading');
  const user = await requireUser();
  if (!user) return;
  byId('whoAmI').textContent = `Signed in as ${user.email}`;

  try {
    const gifts = await listMyGifts();
    if (!gifts.length) return show('empty');
    byId('giftList').replaceChildren(...gifts.map(renderGift));
    show('list');
  } catch (error) {
    byId('errorText').textContent = friendlyError(error);
    show('error');
  }
}

/** Say "saved" once after arriving from the create/edit form, then tidy the URL. */
function confirmArrival() {
  const params = new URLSearchParams(location.search);
  if (params.has('created')) toast('Your gift page is ready ✨', { tone: 'success' });
  else if (params.has('saved')) toast('Changes saved', { tone: 'success' });
  if (params.has('created') || params.has('saved') || location.hash) history.replaceState(null, '', location.pathname);
}

function init() {
  byId('signOut').addEventListener('click', () => signOut());
  byId('retryButton').addEventListener('click', load);
  load().then(confirmArrival);
}

init();
