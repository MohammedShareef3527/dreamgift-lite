/**
 * styleguide.js — makes the components on /styleguide interactive.
 */
import {
  toast, setBusy, openSheet, setProgress, bindCounter, showFieldError, clearFieldError, copyText,
} from '../ui.js';

const byId = (id) => document.getElementById(id);
const UPI_PATTERN = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;

function fillProgressBars() {
  for (const bar of document.querySelectorAll('.progress[data-value]')) {
    setProgress(bar, Number(bar.dataset.value), bar.dataset.text);
  }
}

function replayProgress() {
  for (const bar of document.querySelectorAll('.progress[data-value]')) {
    bar.style.setProperty('--progress', '0');
  }
  window.setTimeout(fillProgressBars, 350);
}

function checkDemoForm(event) {
  event.preventDefault();
  const name = byId('demoName');
  const upi = byId('demoUpi');
  let firstInvalid = null;

  if (!name.value.trim()) {
    showFieldError(name, 'Please add your name.');
    firstInvalid ??= name;
  } else {
    clearFieldError(name);
  }

  if (!UPI_PATTERN.test(upi.value.trim())) {
    showFieldError(upi, 'That doesn\'t look like a UPI ID. It should look like name@bank.');
    firstInvalid ??= upi;
  } else {
    clearFieldError(upi);
  }

  if (firstInvalid) firstInvalid.focus();
  else toast('Looks good. Details saved ✨', { tone: 'success' });
}

function init() {
  fillProgressBars();
  byId('replayProgress').addEventListener('click', replayProgress);

  bindCounter(byId('demoBlessing'), byId('demoBlessingCount'), 300);
  byId('demoForm').addEventListener('submit', checkDemoForm);
  byId('clearErrors').addEventListener('click', () => {
    clearFieldError(byId('demoName'));
    clearFieldError(byId('demoUpi'));
  });

  const busyButton = byId('busyDemo');
  busyButton.addEventListener('click', () => {
    setBusy(busyButton, true, 'Saving…');
    window.setTimeout(() => {
      setBusy(busyButton, false);
      toast('Gift saved', { tone: 'success' });
    }, 1600);
  });

  byId('copyUpi').addEventListener('click', async () => {
    const ok = await copyText(byId('copyUpiValue').textContent);
    toast(ok ? 'UPI ID copied' : 'Couldn\'t copy. Press and hold the UPI ID to copy it.', { tone: ok ? 'success' : 'error' });
  });

  const sheet = byId('chipSheet');
  byId('openSheet').addEventListener('click', () => openSheet(sheet, { initialFocus: byId('sheetName') }));

  const messages = {
    success: 'Confirmed — thank you!',
    error: 'Couldn\'t reach the server. Please try again.',
    info: 'Link copied. Paste it in your WhatsApp group.',
  };
  for (const button of document.querySelectorAll('[data-toast]')) {
    button.addEventListener('click', () => toast(messages[button.dataset.toast], { tone: button.dataset.toast }));
  }

  const retry = byId('retryDemo');
  retry.addEventListener('click', () => {
    setBusy(retry, true, 'Trying again…');
    window.setTimeout(() => setBusy(retry, false), 1200);
  });
}

init();
