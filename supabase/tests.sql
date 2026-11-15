-- =============================================================================
-- DreamGift Lite — security tests for RLS and the public functions.
--
-- Run in Supabase → SQL Editor AFTER schema.sql. It creates two throwaway
-- organisers (…@dreamgift.invalid) with test gifts, checks what a friend
-- (anon role) and each organiser can and cannot do, then deletes everything
-- it created.
--
--   Pass: one row,  "PASS: all NN checks passed"
--   Fail: an error, "FAILED: <which check> …" (nothing is left behind)
-- =============================================================================

reset role;
select set_config('request.jwt.claims', '', false);
select set_config('dg.passed', '0', false);

-- Leftovers from an earlier interrupted run (gifts and contributions cascade).
delete from auth.users where id in ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b');

-- ---------- test helpers (dropped at the end) ----------

create or replace function public._dg_check(ok boolean, label text)
returns void language plpgsql as $$
begin
  if ok is not true then
    raise exception 'FAILED: %', label;
  end if;
  perform set_config('dg.passed', (current_setting('dg.passed')::int + 1)::text, false);
end;
$$;

-- Runs a statement that must fail with one of the given SQLSTATEs.
create or replace function public._dg_expect_error(stmt text, label text, codes text[] default array['42501'])
returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate = any(codes) then
      perform public._dg_check(true, label);
      return;
    end if;
    raise exception 'FAILED: % (expected error %, got % "%")', label, codes, sqlstate, sqlerrm;
  end;
  raise exception 'FAILED: % (the statement was allowed)', label;
end;
$$;

-- Runs an UPDATE/DELETE and returns how many rows it touched.
create or replace function public._dg_rows(stmt text)
returns integer language plpgsql as $$
declare n integer;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public._dg_check(boolean, text) to anon, authenticated;
grant execute on function public._dg_expect_error(text, text, text[]) to anon, authenticated;
grant execute on function public._dg_rows(text) to anon, authenticated;

-- ---------- fixtures (as the database owner) ----------

insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-4000-8000-00000000000a', 'organiser-a@dreamgift.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000b', 'organiser-b@dreamgift.invalid', 'authenticated', 'authenticated');

insert into public.group_gifts
  (id, slug, owner_id, couple_names, wedding_date, gift_title, target_paise, organiser_name, organiser_upi, show_amounts, status)
values
  ('10000000-0000-4000-8000-0000000000a1', 'testgfta', '00000000-0000-4000-8000-00000000000a',
   'Ananya & Rohan', '2026-12-12', 'Honeymoon dinner in Goa', 6000000, 'Rahul', 'rahul.mehta@okhdfcbank', false, 'active'),
  ('10000000-0000-4000-8000-0000000000a2', 'testgftc', '00000000-0000-4000-8000-00000000000a',
   'Meera & Kabir', '2026-10-01', 'A weekend in Coorg', 4000000, 'Rahul', 'rahul.mehta@okhdfcbank', false, 'closed'),
  ('10000000-0000-4000-8000-0000000000b1', 'testgftb', '00000000-0000-4000-8000-00000000000b',
   'Isha & Dev', '2027-02-14', 'A new espresso machine', 3000000, 'Sana', 'sana@okicici', true, 'active');

insert into public.contributions
  (id, gift_id, contributor_name, amount_paise, blessing, blessing_hidden, show_name, status, source, edit_token_hash)
values
  -- gift A1 (amounts private)
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a1', 'Karthik', 200000, 'Congratulations, you two!', false, true, 'confirmed', 'cash', null),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-0000000000a1', 'Secret Sam', 500000, 'Be happy always', false, false, 'confirmed', 'upi', encode(extensions.digest('token-2', 'sha256'), 'hex')),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-0000000000a1', 'Priya', 100000, 'Waiting to see the photos', false, true, 'marked_paid', 'upi', encode(extensions.digest('token-3', 'sha256'), 'hex')),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-0000000000a1', 'Hidden Harry', 300000, 'HIDDEN_BLESSING_TEXT', true, true, 'confirmed', 'upi', encode(extensions.digest('token-4', 'sha256'), 'hex')),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-0000000000a1', 'Pledged Pooja', 50000, 'PLEDGE_ONLY_TEXT', false, true, 'pledged', 'upi', encode(extensions.digest('token-5', 'sha256'), 'hex')),
  -- gift B1 (amounts public)
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-0000000000b1', 'Neha', 250000, 'Many happy returns of the coffee', false, true, 'confirmed', 'upi', encode(extensions.digest('token-6', 'sha256'), 'hex')),
  ('20000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-0000000000b1', 'Arjun', 150000, 'B_SECRET_WAITING', false, true, 'marked_paid', 'upi', encode(extensions.digest('token-7', 'sha256'), 'hex'));

-- =============================================================================
-- 1. A friend who isn't signed in (anon)
-- =============================================================================
set role anon;

do $$
declare
  g jsonb;
  b jsonb;
  pledge record;
  st text;
begin
  -- No direct table access at all
  perform public._dg_expect_error('select * from public.group_gifts', 'anon cannot read group_gifts');
  perform public._dg_expect_error('select * from public.contributions', 'anon cannot read contributions');
  perform public._dg_expect_error('select edit_token_hash from public.contributions', 'anon cannot read edit_token_hash');
  perform public._dg_expect_error($s$insert into public.group_gifts (couple_names, wedding_date, gift_title, target_paise, organiser_name, organiser_upi) values ('X', '2027-01-01', 'X', 100000, 'X', 'x@okaxis')$s$, 'anon cannot create gifts');
  perform public._dg_expect_error($s$insert into public.contributions (gift_id, contributor_name, amount_paise, status, source) values ('10000000-0000-4000-8000-0000000000a1', 'Faker', 100000, 'confirmed', 'cash')$s$, 'anon cannot insert contributions directly');
  perform public._dg_expect_error($s$update public.contributions set status = 'confirmed'$s$, 'anon cannot confirm contributions');
  perform public._dg_expect_error($s$delete from public.group_gifts$s$, 'anon cannot delete gifts');
  perform public._dg_expect_error($s$select public.generate_slug()$s$, 'anon cannot call internal helpers');

  -- get_public_gift: public fields only, totals from confirmed money only
  select to_jsonb(x) into g from public.get_public_gift('testgfta') x;
  perform public._dg_check(g is not null, 'public gift is found by slug');
  perform public._dg_check(
    (select array_agg(k order by k) from jsonb_object_keys(g) k) =
    array['confirmed_paise','contributor_count','couple_names','deadline','gift_story','gift_title','is_open',
          'organiser_name','organiser_upi','razorpay_link','show_amounts','slug','status','target_paise','wedding_date'],
    'public gift exposes exactly the public fields (no id, owner_id, timestamps)');
  perform public._dg_check((g->>'confirmed_paise')::bigint = 1000000, 'progress counts confirmed money only (₹10,000, not pledged or waiting)');
  perform public._dg_check((g->>'contributor_count')::int = 3, 'contributor count is confirmed contributions only');
  perform public._dg_check((g->>'is_open')::boolean, 'active gift is open');
  perform public._dg_check((select count(*) from public.get_public_gift('  TESTGFTA ')) = 1, 'slug lookup ignores case and spaces');
  perform public._dg_check((select count(*) from public.get_public_gift('nosuchgi')) = 0, 'unknown slug returns nothing');
  perform public._dg_check(not (select is_open from public.get_public_gift('testgftc')), 'closed gift is not open');

  -- get_public_blessings: privacy rules
  select jsonb_agg(to_jsonb(x)) into b from public.get_public_blessings('testgfta') x;
  perform public._dg_check(jsonb_array_length(b) = 3, 'wall shows confirmed + waiting blessings, not hidden or pledge-only');
  perform public._dg_check(
    (select array_agg(k order by k) from jsonb_object_keys(b->0) k) = array['amount_paise','blessing','created_at','name'],
    'blessings expose exactly name, amount, blessing, time');
  perform public._dg_check(position('HIDDEN_BLESSING_TEXT' in b::text) = 0 and position('Hidden Harry' in b::text) = 0, 'hidden blessing and its author never appear');
  perform public._dg_check(position('PLEDGE_ONLY_TEXT' in b::text) = 0, 'pledge-only blessing does not appear until marked paid');
  perform public._dg_check(position('Secret Sam' in b::text) = 0 and b @> '[{"name": "A friend", "blessing": "Be happy always"}]', 'private name shows as "A friend"');
  perform public._dg_check(not exists (select 1 from jsonb_array_elements(b) e where e->>'amount_paise' is not null), 'amounts hidden when show_amounts is off');
  select jsonb_agg(to_jsonb(x)) into b from public.get_public_blessings('testgftb') x;
  perform public._dg_check(b @> '[{"name": "Neha", "amount_paise": 250000}]', 'confirmed amount shown when show_amounts is on');
  perform public._dg_check(b @> '[{"name": "Arjun"}]' and not b @> '[{"name": "Arjun", "amount_paise": 150000}]', 'unconfirmed amount never shown');

  -- create_pledge
  select * into pledge from public.create_pledge('testgfta', '  Zoya  ', 100000, 'Have the best trip!', true);
  perform public._dg_check(pledge.contribution_id is not null and pledge.edit_token ~ '^[0-9a-f]{64}$', 'pledge returns an id and a 64-char token');
  perform set_config('dg.pledge_id', pledge.contribution_id::text, false);
  perform set_config('dg.pledge_token', pledge.edit_token, false);
  perform public._dg_check((select confirmed_paise from public.get_public_gift('testgfta')) = 1000000, 'a new pledge does not move progress');
  perform public._dg_expect_error($s$select public.create_pledge('testgftc', 'Zoya', 100000, '', true)$s$, 'cannot pledge to a closed gift', array['P0001']);
  perform public._dg_expect_error($s$select public.create_pledge('nosuchgi', 'Zoya', 100000, '', true)$s$, 'cannot pledge to an unknown gift', array['P0002']);
  perform public._dg_expect_error($s$select public.create_pledge('testgfta', 'Zoya', 999, '', true)$s$, 'pledge below ₹10 rejected', array['23514']);
  perform public._dg_expect_error($s$select public.create_pledge('testgfta', 'Zoya', 10000001, '', true)$s$, 'pledge above ₹1,00,000 rejected', array['23514']);
  perform public._dg_expect_error($s$select public.create_pledge('testgfta', '   ', 100000, '', true)$s$, 'blank name rejected', array['23514']);
  perform public._dg_expect_error($s$select public.create_pledge('testgfta', repeat('n', 61), 100000, '', true)$s$, 'name over 60 characters rejected', array['23514']);
  perform public._dg_expect_error($s$select public.create_pledge('testgfta', 'Zoya', 100000, repeat('b', 301), true)$s$, 'blessing over 300 characters rejected', array['23514']);

  -- mark_paid / get_my_pledge
  perform public._dg_expect_error(format('select public.mark_paid(%L, %L)', pledge.contribution_id, 'wrong-token'), 'mark_paid refuses a wrong token', array['28000']);
  perform public._dg_expect_error($s$select public.mark_paid('20000000-0000-4000-8000-000000000001', '')$s$, 'mark_paid refuses an empty token', array['28000']);
  perform public._dg_check((select count(*) from public.get_my_pledge(pledge.contribution_id, 'wrong-token')) = 0, 'get_my_pledge reveals nothing without the token');
  st := public.mark_paid(pledge.contribution_id, pledge.edit_token);
  perform public._dg_check(st = 'marked_paid', 'mark_paid with the right token moves pledged → marked_paid');
  st := public.mark_paid(pledge.contribution_id, pledge.edit_token);
  perform public._dg_check(st = 'marked_paid', 'mark_paid is safe to call twice');
  perform public._dg_check((select status from public.get_my_pledge(pledge.contribution_id, pledge.edit_token)) = 'marked_paid', 'friend can see their own status with the token');
  perform public._dg_check((select status from public.get_my_pledge('20000000-0000-4000-8000-000000000002', 'token-2')) = 'confirmed', 'mark_paid never downgrades a confirmed contribution');
  perform public._dg_check((select confirmed_paise from public.get_public_gift('testgfta')) = 1000000, 'marking paid still does not move progress');
end;
$$;

-- =============================================================================
-- 2. Organiser A (signed in)
-- =============================================================================
set role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}', false);

do $$
declare
  new_slug text;
begin
  perform public._dg_check((select count(*) from public.group_gifts) = 2, 'organiser sees only their own 2 gifts');
  perform public._dg_check((select count(*) from public.group_gifts where slug = 'testgftb') = 0, 'organiser cannot see another organiser''s gift');
  perform public._dg_check((select count(*) from public.contributions where gift_id = '10000000-0000-4000-8000-0000000000b1') = 0, 'organiser cannot see another organiser''s contributions');
  perform public._dg_check((select count(*) from public.contributions) = 6, 'organiser sees every contribution to their own gift, hidden ones included');
  perform public._dg_expect_error('select edit_token_hash from public.contributions', 'organiser cannot read edit_token_hash');
  perform public._dg_expect_error('select * from public.contributions', 'select * is refused because of the private token column');

  perform public._dg_check(public._dg_rows($s$update public.group_gifts set gift_title = 'Hacked' where slug = 'testgftb'$s$) = 0, 'organiser cannot edit another organiser''s gift');
  perform public._dg_check(public._dg_rows($s$update public.contributions set status = 'confirmed' where gift_id = '10000000-0000-4000-8000-0000000000b1'$s$) = 0, 'organiser cannot confirm another organiser''s contributions');
  perform public._dg_check(public._dg_rows($s$delete from public.group_gifts where slug = 'testgftb'$s$) = 0, 'organiser cannot delete another organiser''s gift');
  perform public._dg_expect_error($s$update public.group_gifts set owner_id = '00000000-0000-4000-8000-00000000000b' where slug = 'testgfta'$s$, 'organiser cannot hand a gift to someone else');
  perform public._dg_expect_error($s$update public.group_gifts set slug = 'mynewurl' where slug = 'testgfta'$s$, 'organiser cannot change a slug');
  perform public._dg_expect_error($s$insert into public.contributions (gift_id, contributor_name, amount_paise, status, source) values ('10000000-0000-4000-8000-0000000000b1', 'Cash', 100000, 'confirmed', 'cash')$s$, 'organiser cannot add cash to another organiser''s gift');
  perform public._dg_expect_error($s$insert into public.contributions (gift_id, contributor_name, amount_paise, status, source) values ('10000000-0000-4000-8000-0000000000a1', 'Fake', 100000, 'confirmed', 'upi')$s$, 'organiser can only add cash, not fake UPI entries');
  perform public._dg_expect_error($s$update public.contributions set amount_paise = 9999999 where id = '20000000-0000-4000-8000-000000000003'$s$, 'organiser cannot change a friend''s amount');

  -- What organisers should be able to do
  insert into public.group_gifts (couple_names, wedding_date, gift_title, target_paise, organiser_name, organiser_upi)
  values ('Tara & Vikram', '2027-03-03', 'A painting for their new home', 2500000, 'Rahul', 'rahul.mehta@okhdfcbank')
  returning slug into new_slug;
  perform public._dg_check(new_slug ~ '^[a-z0-9]{8}$', 'new gift gets a random 8-character slug');

  perform public._dg_check(public._dg_rows($s$update public.contributions set status = 'confirmed' where id = '20000000-0000-4000-8000-000000000003'$s$) = 1, 'organiser confirms a contribution');
  perform public._dg_check((select confirmed_at is not null from public.contributions where id = '20000000-0000-4000-8000-000000000003'), 'confirmed_at is stamped on confirm');
  perform public._dg_check((select confirmed_paise from public.get_public_gift('testgfta')) = 1100000, 'progress moves only after the organiser confirms');
  perform public._dg_check(public._dg_rows($s$update public.contributions set status = 'rejected' where id = '20000000-0000-4000-8000-000000000003'$s$) = 1, 'organiser can reject (undo) a contribution');
  perform public._dg_check((select confirmed_at is null from public.contributions where id = '20000000-0000-4000-8000-000000000003'), 'confirmed_at is cleared when no longer confirmed');
  perform public._dg_check((select confirmed_paise from public.get_public_gift('testgfta')) = 1000000, 'rejected money leaves the progress bar');

  insert into public.contributions (gift_id, contributor_name, amount_paise, blessing, status, source)
  values ('10000000-0000-4000-8000-0000000000a1', 'Dadi', 500000, 'Jeete raho!', 'confirmed', 'cash');
  perform public._dg_check((select confirmed_paise from public.get_public_gift('testgfta')) = 1500000, 'cash entry counts straight away');

  perform public._dg_check(public._dg_rows($s$update public.contributions set blessing_hidden = true where contributor_name = 'Karthik'$s$) = 1, 'organiser hides a blessing');
  perform public._dg_check(position('Congratulations, you two!' in (select coalesce(jsonb_agg(to_jsonb(x)), '[]')::text from public.get_public_blessings('testgfta') x)) = 0, 'hidden blessing disappears from the public wall');
  perform public._dg_check(public._dg_rows($s$update public.group_gifts set razorpay_link = 'https://razorpay.me/@rahulmehta' where slug = 'testgfta'$s$) = 1, 'organiser adds a Razorpay link');
  perform public._dg_check((select razorpay_link from public.get_public_gift('testgfta')) = 'https://razorpay.me/@rahulmehta', 'friends see the Razorpay link');
  perform public._dg_expect_error($s$update public.group_gifts set razorpay_link = 'javascript:alert(1)' where slug = 'testgfta'$s$, 'a javascript: link is refused', array['23514']);
  perform public._dg_expect_error($s$update public.group_gifts set razorpay_link = 'https://razorpay.me.evil.com/@x' where slug = 'testgfta'$s$, 'a look-alike domain is refused', array['23514']);
  perform public._dg_expect_error($s$update public.group_gifts set razorpay_link = 'http://rzp.io/l/abc' where slug = 'testgfta'$s$, 'a non-https link is refused', array['23514']);
  perform public._dg_check(public._dg_rows($s$update public.group_gifts set status = 'closed' where slug = 'testgfta'$s$) = 1, 'organiser closes their gift');
end;
$$;

-- The closed gift now refuses pledges, even from a friend.
set role anon;
select set_config('request.jwt.claims', '', false);
do $$
begin
  perform public._dg_expect_error($s$select public.create_pledge('testgfta', 'Late Lata', 100000, '', true)$s$, 'closing a gift stops new pledges', array['P0001']);
end;
$$;

-- =============================================================================
-- 3. Organiser B sees none of A's data
-- =============================================================================
set role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b", "role": "authenticated"}', false);
do $$
begin
  perform public._dg_check((select count(*) from public.group_gifts) = 1, 'organiser B sees only their own gift');
  perform public._dg_check((select count(*) from public.contributions) = 2, 'organiser B sees only their own contributions');
  perform public._dg_check(public._dg_rows($s$update public.contributions set blessing_hidden = false where gift_id = '10000000-0000-4000-8000-0000000000a1'$s$) = 0, 'organiser B cannot un-hide A''s blessings');
end;
$$;

-- =============================================================================
-- Clean up and report
-- =============================================================================
reset role;
select set_config('request.jwt.claims', '', false);
delete from auth.users where id in ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b');
drop function public._dg_check(boolean, text);
drop function public._dg_expect_error(text, text, text[]);
drop function public._dg_rows(text);

select 'PASS: all ' || current_setting('dg.passed') || ' checks passed' as result;
