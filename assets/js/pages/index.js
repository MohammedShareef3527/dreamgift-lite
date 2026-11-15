/**
 * index.js — landing page: magic-link sign-in and "Start a group gift".
 */
import { getUser, sendMagicLink, safeNext, authErrorFromUrl } from '../supabase.js';
import { friendlyError } from '../api.js';
import { looksLikeEmail } from '../validate.js';
import { setBusy, showFieldError, clearFieldError, announce, toast } from '../ui.js';

const RESEND_SECONDS = 60;
const byId = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
let next = params.has('next') ? safeNext(params.get('next')) : '/dashboard';
let lastEmail = '';
let cooldownTimer = 0;

/** @param {string|null} code */
function authErrorMessage(code) {
  if (!code) return '';
  if (code === 'otp_expired' || code === 'access_denied') {
    return 'That sign-in link has expired or was already used. Enter your email and we\'ll send a fresh one.';
  }
  return 'We couldn\'t sign you in with that link. Please ask for a new one below.';
}

function goToSignIn({ focus = true } = {}) {
  const section = byId('sign-in');
  section.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  if (focus) byId('email').focus({ preventScroll: true });
}

function showSent(email) {
  byId('signInForm-wrap').hidden = true;
  byId('sentState').hidden = false;
  byId('sentEmail').textContent = email;
  byId('sentTitle').focus();
  announce(`Sign-in link sent to ${email}.`);
  startCooldown();
}

function showForm() {
  window.clearInterval(cooldownTimer);
  byId('sentState').hidden = true;
  byId('signInForm-wrap').hidden = false;
  byId('email').focus();
}

function startCooldown() {
  const button = byId('resendButton');
  let left = RESEND_SECONDS;
  const tick = () => {
    if (left <= 0) {
      window.clearInterval(cooldownTimer);
      button.disabled = false;
      button.textContent = 'Send it again';
      return;
    }
    button.disabled = true;
    button.textContent = `Send again in ${left}s`;
    left -= 1;
  };
  window.clearInterval(cooldownTimer);
  tick();
  cooldownTimer = window.setInterval(tick, 1000);
}

/** @param {SubmitEvent} event */
async function onSubmit(event) {
  event.preventDefault();
  const input = byId('email');
  const email = input.value.trim();
  if (!looksLikeEmail(email)) {
    showFieldError(input, email ? 'That email address doesn\'t look right. Please check it.' : 'Enter your email address.');
    input.focus();
    return;
  }
  clearFieldError(input);

  const button = byId('signInButton');
  setBusy(button, true, 'Sending your link…');
  try {
    await sendMagicLink(email, next);
    lastEmail = email;
    byId('authErrorNotice').hidden = true;
    showSent(email);
  } catch (error) {
    showFieldError(input, friendlyError(error));
    input.focus();
  } finally {
    setBusy(button, false);
  }
}

async function onResend() {
  const button = byId('resendButton');
  setBusy(button, true, 'Sending…');
  try {
    await sendMagicLink(lastEmail, next);
    setBusy(button, false);
    toast('A fresh link is on its way', { tone: 'success' });
    startCooldown();
  } catch (error) {
    setBusy(button, false);
    toast(friendlyError(error), { tone: 'error' });
  }
}

function showSignedIn(user) {
  byId('navSignIn').hidden = true;
  byId('navDashboard').hidden = false;
  byId('signInForm-wrap').hidden = true;
  byId('signedInState').hidden = false;
  byId('signedInEmail').textContent = user.email || '';
}

async function init() {
  byId('signInForm').addEventListener('submit', onSubmit);
  byId('email').addEventListener('input', () => clearFieldError(byId('email')));
  byId('resendButton').addEventListener('click', onResend);
  byId('changeEmail').addEventListener('click', showForm);

  const errorText = authErrorMessage(params.get('auth_error') || authErrorFromUrl());
  if (errorText) {
    byId('authErrorText').textContent = errorText;
    byId('authErrorNotice').hidden = false;
  }
  // Tidy the address bar so a refresh doesn't repeat old messages.
  if (params.has('auth_error') || location.hash.includes('error')) {
    history.replaceState(null, '', `${location.pathname}${params.has('next') ? `?next=${encodeURIComponent(next)}` : ''}#sign-in`);
  }

  let user = null;
  try {
    user = await getUser();
  } catch {
    user = null; // treat as signed out; the form still works
  }

  if (user && params.has('next')) {
    location.replace(next);
    return;
  }

  if (user) {
    showSignedIn(user);
  } else {
    byId('startGift').addEventListener('click', (event) => {
      event.preventDefault();
      next = '/create';
      goToSignIn();
      announce('Sign in first, then you\'ll go straight to your new gift page.');
    });
    byId('navSignIn').addEventListener('click', (event) => {
      event.preventDefault();
      goToSignIn();
    });
  }

  if (errorText || (location.hash === '#sign-in' && !user)) goToSignIn();
}

init();
