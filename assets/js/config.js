/**
 * config.js — the only place the Supabase connection details live.
 * Both values are public by design: the publishable key can only do what
 * Row Level Security and the public functions in supabase/schema.sql allow.
 * Never put the service_role / secret key in any front-end file.
 */
export const SUPABASE_URL = 'https://oswurpukjsfjubgqodtc.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_hDfYLWQzLK6A10yUJ9fagQ_zWTogm_D';
