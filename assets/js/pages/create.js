/**
 * create.js — create a gift page, or edit one with /create?id={uuid}.
 */
import { requireUser, signOut } from '../supabase.js';
import { getMyGift, createGift, updateGift, getLastPayoutDetails, friendlyError, NotFoundError } from '../api.js';
import { validateGift, todayISO, LIMITS } from '../validate.js';
import { rupeesToPaise } from '../format.js';
import { setBusy, showFieldError, clearFieldError, bindCounter, toast, announce } from '../ui.js';

const byId = (id) => document.getElementById(id);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Form controls in the order they appear, so the first error gets focus. */
const FIELDS = ['coupleNames', 'weddingDate', 'giftTitle', 'giftStory', 'target', 'organiserName', 'organiserUpi', 'razorpayLink', 'deadline'];
const GROUPING = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

const giftId = new URLSearchParams(location.search).get('id');
const isEdit = giftId !== null;
let originalDeadline = null;
let dirty = false;
let submitting = false;

/** @param {'loading'|'error'|'form'} view */
function show(view) {
  byId('loadingState').hidden = view !== 'loading';
  byId('errorState').hidden = view !== 'error';
  byId('formView').hidden = view !== 'form';
}

function showError(title, text, { retry = true } = {}) {
  byId('errorTitle').textContent = title;
  byId('errorText').textContent = text;
  byId('retryButton').hidden = !retry;
  show('error');
}

/** Keep the "Waiting for {name} to confirm" hint in step with the name field. */
function updateNamePreview() {
  byId('namePreview').textContent = byId('organiserName').value.trim() || 'you';
}

/** Show "60000" as "60,000" once the person leaves the field. */
function tidyTarget() {
  const input = byId('target');
  const paise = rupeesToPaise(input.value);
  if (paise !== null && paise > 0) input.value = GROUPING.format(paise / 100);
}

/** @param {object} gift a row from group_gifts */
function fillForm(gift) {
  byId('coupleNames').value = gift.couple_names;
  byId('weddingDate').value = gift.wedding_date;
  byId('giftTitle').value = gift.gift_title;
  byId('giftStory').value = gift.gift_story || '';
  byId('target').value = GROUPING.format(gift.target_paise / 100);
  byId('organiserName').value = gift.organiser_name;
  byId('organiserUpi').value = gift.organiser_upi;
  byId('razorpayLink').value = gift.razorpay_link || '';
  byId('deadline').value = gift.deadline || '';
  byId('showAmounts').checked = gift.show_amounts;
  byId('giftStory').dispatchEvent(new Event('input')); // refresh the counter
  updateNamePreview();
}

function readForm() {
  const values = Object.fromEntries(FIELDS.map((name) => [name, byId(name).value]));
  values.showAmounts = byId('showAmounts').checked;
  return values;
}

/** @param {Record<string, string>} errors */
function showErrors(errors) {
  let first = null;
  for (const name of FIELDS) {
    const control = byId(name);
    if (errors[name]) {
      showFieldError(control, errors[name]);
      first ??= control;
    } else {
      clearFieldError(control);
    }
  }
  if (first) {
    first.focus();
    const count = Object.keys(errors).length;
    announce(count === 1 ? 'One field needs a fix.' : `${count} fields need a fix.`, { assertive: true });
  }
}

/** @param {SubmitEvent} event */
async function onSubmit(event) {
  event.preventDefault();
  if (submitting) return;
  byId('formError').hidden = true;

  const { data, errors } = validateGift(readForm(), { today: todayISO(), originalDeadline });
  if (!data) {
    showErrors(errors);
    return;
  }
  showErrors({});

  const button = byId('submitButton');
  submitting = true;
  setBusy(button, true, isEdit ? 'Saving…' : 'Creating your page…');
  try {
    const saved = isEdit ? await updateGift(giftId, data) : await createGift(data);
    dirty = false;
    location.assign(isEdit
      ? `/dashboard?gift=${encodeURIComponent(saved.id)}&saved=1`
      : `/dashboard?gift=${encodeURIComponent(saved.id)}&created=1`);
  } catch (error) {
    submitting = false;
    setBusy(button, false);
    byId('formErrorText').textContent = friendlyError(error);
    byId('formError').hidden = false;
    toast(isEdit ? 'Couldn\'t save your changes' : 'Couldn\'t create the page', { tone: 'error' });
  }
}

function setEditCopy(gift) {
  document.title = `Edit ${gift.gift_title} · DreamGift Lite`;
  byId('formEyebrow').textContent = `For ${gift.couple_names}`;
  byId('formTitle').textContent = 'Edit gift details';
  byId('formLead').textContent = 'Changes show on the gift page straight away.';
  byId('submitButton').textContent = 'Save changes';
}

async function load() {
  show('loading');
  const user = await requireUser();
  if (!user) return;

  if (!isEdit) {
    byId('deadline').min = todayISO();
    try {
      const last = await getLastPayoutDetails();
      if (last) {
        byId('organiserName').value = last.organiser_name;
        byId('organiserUpi').value = last.organiser_upi;
        updateNamePreview();
      }
    } catch {
      // Prefill is a nicety; the form works without it.
    }
    show('form');
    byId('coupleNames').focus();
    return;
  }

  if (!UUID.test(giftId)) {
    showError('We couldn\'t find that gift', 'The link may be incomplete. Open the gift from your dashboard instead.', { retry: false });
    return;
  }
  try {
    const gift = await getMyGift(giftId);
    originalDeadline = gift.deadline;
    setEditCopy(gift);
    fillForm(gift);
    dirty = false; // filling the form isn't an edit
    show('form');
    byId('formTitle').setAttribute('tabindex', '-1');
    byId('formTitle').focus();
  } catch (error) {
    if (error instanceof NotFoundError) {
      showError('We couldn\'t find that gift', 'It may have been deleted, or it belongs to a different account.', { retry: false });
    } else {
      showError('We couldn\'t load this gift', friendlyError(error));
    }
  }
}

function init() {
  bindCounter(byId('giftStory'), byId('giftStoryCount'), LIMITS.story);
  byId('giftForm').addEventListener('submit', onSubmit);
  byId('giftForm').addEventListener('input', (event) => {
    dirty = true;
    if (event.target.id && FIELDS.includes(event.target.id)) clearFieldError(event.target);
  });
  byId('giftForm').addEventListener('change', () => { dirty = true; });
  byId('target').addEventListener('blur', tidyTarget);
  byId('organiserName').addEventListener('input', updateNamePreview);
  byId('retryButton').addEventListener('click', load);
  byId('signOut').addEventListener('click', () => signOut());
  window.addEventListener('beforeunload', (event) => {
    if (dirty && !submitting) event.preventDefault();
  });
  load();
}

init();
