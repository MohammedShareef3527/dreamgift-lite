/**
 * supabase.js — the one Supabase client, plus organiser sign-in helpers.
 * supabase-js is pinned to an exact version; bump it deliberately.
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

/** Where organisers may be sent after signing in. Anything else falls back to the dashboard. */
const NEXT_PATTERN = /^\/(dashboard|create)(\?id=[0-9a-f-]{36})?$/;
const DEFAULT_NEXT = '/dashboard';

/**
 * Read a magic-link failure (expired or already used) from the URL. This has to
 * happen before the client is created, because the client tidies the URL.
 * @param {Location} location
 * @returns {string|null} an error code such as "otp_expired"
 */
function readAuthError(location) {
  const params = new URLSearchParams(location.hash.slice(1));
  for (const [key, value] of new URLSearchParams(location.search)) params.set(key, value);
  if (!params.has('error') && !params.has('error_code')) return null;
  return params.get('error_code') || params.get('error') || 'auth_error';
}

const authErrorOnLoad = readAuthError(window.location);

// Implicit flow so a link requested on a laptop still works when opened on a phone.
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    flowType: 'implicit',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * A safe in-app path to continue to after sign-in.
 * @param {string|null|undefined} next
 * @returns {string}
 */
export function safeNext(next) {
  return typeof next === 'string' && NEXT_PATTERN.test(next) ? next : DEFAULT_NEXT;
}

/**
 * The signed-in organiser, or null.
 * @returns {Promise<import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm').User|null>}
 */
export async function getUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

/**
 * For organiser-only pages: return the user, or send them to sign in and
 * come back here afterwards. Resolves to null while the browser navigates away.
 * @returns {Promise<object|null>}
 */
export async function requireUser() {
  const user = await getUser();
  if (user) return user;
  const params = new URLSearchParams({ next: safeNext(location.pathname + location.search) });
  if (authErrorOnLoad) params.set('auth_error', authErrorOnLoad);
  location.replace(`/?${params}#sign-in`);
  return null;
}

/**
 * Email a one-time sign-in link.
 * @param {string} email
 * @param {string} [next] path to land on after clicking the link
 */
export async function sendMagicLink(email, next) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: new URL(safeNext(next), location.origin).href,
      shouldCreateUser: true,
    },
  });
  if (error) throw error;
}

/** Sign out on this device and go to the home page. */
export async function signOut() {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } finally {
    location.assign('/');
  }
}

/**
 * The magic-link error this page was opened with, if any.
 * @returns {string|null}
 */
export function authErrorFromUrl() {
  return authErrorOnLoad;
}
