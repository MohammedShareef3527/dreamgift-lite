/**
 * ui.js — shared behaviour for the components in components.css.
 * All user-supplied text is written with textContent, never innerHTML.
 */

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------------------
// Screen-reader announcements
// ---------------------------------------------------------------------------

/**
 * Live regions must exist before they change, or screen readers miss the
 * first message. While a modal sheet is open the rest of the page is inert,
 * so each open sheet gets its own pair.
 * @param {Element} host
 */
function ensureLiveRegions(host) {
  for (const assertive of [false, true]) {
    const cls = assertive ? 'live-assertive' : 'live-polite';
    if (host.querySelector(`:scope > .${cls}`)) continue;
    const el = document.createElement('div');
    el.className = `visually-hidden ${cls}`;
    el.setAttribute('role', assertive ? 'alert' : 'status');
    el.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
    host.append(el);
  }
}

ensureLiveRegions(document.body);

/**
 * Read a message out to screen-reader users without showing anything.
 * @param {string} message
 * @param {{ assertive?: boolean }} [options]
 */
export function announce(message, { assertive = false } = {}) {
  const host = document.querySelector('dialog[open]') || document.body;
  ensureLiveRegions(host);
  const el = host.querySelector(`:scope > .${assertive ? 'live-assertive' : 'live-polite'}`);
  el.textContent = '';
  window.setTimeout(() => { el.textContent = message; }, 60);
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

let toastRegion = null;
const supportsPopover = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;

function getToastRegion() {
  if (!toastRegion) {
    toastRegion = document.createElement('div');
    toastRegion.className = 'toast-region';
    toastRegion.setAttribute('aria-hidden', 'true'); // announce() speaks the text instead
    if (supportsPopover) toastRegion.popover = 'manual';
    document.body.append(toastRegion);
  }
  toastRegion.classList.toggle('toast-region--top', !!document.querySelector('dialog[open]'));
  // Re-opening a popover moves it to the top of the top layer, above any open sheet.
  if (supportsPopover) {
    if (toastRegion.matches(':popover-open')) toastRegion.hidePopover();
    toastRegion.showPopover();
  }
  return toastRegion;
}

/**
 * Show a short message at the bottom of the screen and announce it.
 * @param {string} message
 * @param {{ tone?: 'info'|'success'|'error', duration?: number }} [options]
 */
export function toast(message, { tone = 'info', duration = 4000 } = {}) {
  const region = getToastRegion();
  const el = document.createElement('div');
  el.className = `toast toast--${tone}`;
  el.textContent = message;
  region.append(el);
  announce(message, { assertive: tone === 'error' });

  window.setTimeout(() => {
    const remove = () => {
      el.remove();
      if (supportsPopover && !region.children.length && region.matches(':popover-open')) region.hidePopover();
    };
    if (reduceMotion()) return remove();
    el.classList.add('is-leaving');
    el.addEventListener('animationend', remove, { once: true });
  }, duration);
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

const idleContent = new WeakMap(); // button -> its original child nodes

/**
 * Put a button into (or out of) its busy state: disabled, spinner, new label.
 * Disabling stops double submits.
 * @param {HTMLButtonElement} button
 * @param {boolean} busy
 * @param {string} [busyLabel] text to show while busy, e.g. "Saving…"
 */
export function setBusy(button, busy, busyLabel) {
  if (busy) {
    if (button.getAttribute('aria-busy') === 'true') return;
    idleContent.set(button, [...button.childNodes]);
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = busyLabel || button.textContent.trim();
    button.replaceChildren(spinner, label);
  } else {
    const original = idleContent.get(button);
    if (original) button.replaceChildren(...original);
    idleContent.delete(button);
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

// ---------------------------------------------------------------------------
// Sheet (bottom sheet on mobile, modal on desktop) — built on <dialog>
// ---------------------------------------------------------------------------

/** @param {HTMLDialogElement} dialog */
function wireSheet(dialog) {
  if (dialog.dataset.wired) return;
  dialog.dataset.wired = 'true';

  dialog.addEventListener('cancel', (event) => { // Esc key
    event.preventDefault();
    closeSheet(dialog);
  });

  dialog.addEventListener('click', (event) => {
    if (event.target.closest('[data-sheet-close]')) return closeSheet(dialog);
    // A click outside the sheet's box landed on the backdrop.
    const box = dialog.getBoundingClientRect();
    const outside = event.clientX < box.left || event.clientX > box.right ||
      event.clientY < box.top || event.clientY > box.bottom;
    if (outside && event.target === dialog) closeSheet(dialog);
  });
}

/**
 * Open a <dialog class="sheet"> as a modal. Focus moves into it and
 * returns to the opener when it closes.
 * @param {HTMLDialogElement} dialog
 * @param {{ initialFocus?: HTMLElement }} [options]
 */
export function openSheet(dialog, { initialFocus } = {}) {
  wireSheet(dialog);
  if (dialog.open) return;
  dialog.returnFocusTo = document.activeElement;
  dialog.classList.remove('is-closing');
  dialog.showModal();
  ensureLiveRegions(dialog);
  if (initialFocus) initialFocus.focus();
}

/**
 * Close a sheet with its exit animation.
 * @param {HTMLDialogElement} dialog
 */
export function closeSheet(dialog) {
  if (!dialog.open || dialog.classList.contains('is-closing')) return;
  const finish = () => {
    dialog.classList.remove('is-closing');
    dialog.close();
    const opener = dialog.returnFocusTo;
    if (opener && document.contains(opener)) opener.focus();
  };
  if (reduceMotion()) return finish();
  dialog.classList.add('is-closing');
  dialog.addEventListener('animationend', finish, { once: true });
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/**
 * Fill a .progress bar to `value` (0–1). The fill animates from its current width.
 * @param {HTMLElement} bar element with role="progressbar"
 * @param {number} value 0–1
 * @param {string} [valueText] what a screen reader should say, e.g. "₹42,000 of ₹60,000"
 */
export function setProgress(bar, value, valueText) {
  const clamped = Math.min(1, Math.max(0, Number(value) || 0));
  bar.setAttribute('aria-valuenow', String(Math.round(clamped * 100)));
  if (valueText) bar.setAttribute('aria-valuetext', valueText);
  // Two frames so a bar that was just inserted at 0 still transitions.
  requestAnimationFrame(() => requestAnimationFrame(() => bar.style.setProperty('--progress', String(clamped))));
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

/**
 * Show an inline error under a field and mark the control invalid.
 * Expects the error element to have id `${control.id}-error`.
 * @param {HTMLInputElement|HTMLTextAreaElement} control
 * @param {string} message
 */
export function showFieldError(control, message) {
  const error = document.getElementById(`${control.id}-error`);
  if (!error) return;
  error.textContent = message;
  error.hidden = false;
  control.setAttribute('aria-invalid', 'true');
  const ids = new Set((control.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
  ids.add(error.id);
  control.setAttribute('aria-describedby', [...ids].join(' '));
}

/**
 * Remove a field's inline error.
 * @param {HTMLInputElement|HTMLTextAreaElement} control
 */
export function clearFieldError(control) {
  const error = document.getElementById(`${control.id}-error`);
  control.removeAttribute('aria-invalid');
  if (!error) return;
  error.textContent = '';
  error.hidden = true;
  const ids = (control.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && id !== error.id);
  if (ids.length) control.setAttribute('aria-describedby', ids.join(' '));
  else control.removeAttribute('aria-describedby');
}

/**
 * Keep a "120 / 300" counter in step with a text field. Screen readers hear
 * the count only when it gets close to the limit.
 * @param {HTMLInputElement|HTMLTextAreaElement} control
 * @param {HTMLElement} counter
 * @param {number} max
 */
export function bindCounter(control, counter, max) {
  let warned = false;
  const update = () => {
    const length = [...control.value].length; // count emoji as one character
    counter.textContent = `${length} / ${max}`;
    counter.classList.toggle('is-near', length >= max * 0.9 && length <= max);
    counter.classList.toggle('is-over', length > max);
    const near = length >= max * 0.9;
    if (near && !warned) announce(`${max - length} characters left`);
    warned = near;
  };
  control.addEventListener('input', update);
  update();
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

/**
 * Copy text to the clipboard.
 * @param {string} text
 * @returns {Promise<boolean>} whether it worked
 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older iOS and non-secure contexts: fall back to a hidden textarea.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.className = 'visually-hidden';
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}
