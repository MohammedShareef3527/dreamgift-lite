-- =============================================================================
-- DreamGift Lite — database schema
--
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to run again.
--
-- Security model
--   * RLS is on for every table. Signed-in organisers can only touch their own
--     gifts and those gifts' contributions.
--   * The anon role has NO table access at all. Friends (not signed in) only
--     use the SECURITY DEFINER functions at the bottom, which return public
--     fields only.
--   * Money is integer paise. ₹10 = 1000 paise.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- 8-character URL-safe slug, without look-alike characters (0/o, 1/l).
create or replace function public.generate_slug()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  alphabet constant text := 'abcdefghijkmnpqrstuvwxyz23456789'; -- 32 chars, so byte % 32 is unbiased
  bytes bytea := extensions.gen_random_bytes(8);
  result text := '';
begin
  for i in 0..7 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return result;
end;
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- confirmed_at is set when a contribution becomes confirmed, cleared if it stops being confirmed.
create or replace function public.set_confirmed_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'confirmed' then
    if tg_op = 'INSERT' or old.status is distinct from 'confirmed' then
      new.confirmed_at := now();
    end if;
  else
    new.confirmed_at := null;
  end if;
  return new;
end;
$$;

-- Today's date in India, used for deadlines.
create or replace function public.today_ist()
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.group_gifts (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique default public.generate_slug()
                  constraint group_gifts_slug_format check (slug ~ '^[a-z0-9]{8}$'),
  owner_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  couple_names  text not null
                  constraint group_gifts_couple_names_length check (char_length(btrim(couple_names)) between 1 and 60),
  wedding_date  date not null,
  gift_title    text not null
                  constraint group_gifts_gift_title_length check (char_length(btrim(gift_title)) between 1 and 80),
  gift_story    text not null default ''
                  constraint group_gifts_gift_story_length check (char_length(gift_story) <= 500),
  target_paise  bigint not null
                  constraint group_gifts_target_range check (target_paise > 0 and target_paise <= 1000000000), -- up to ₹1 crore
  organiser_name text not null
                  constraint group_gifts_organiser_name_length check (char_length(btrim(organiser_name)) between 1 and 60),
  organiser_upi text not null
                  constraint group_gifts_organiser_upi_format check (organiser_upi ~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,63}$'),
  deadline      date,
  show_amounts  boolean not null default false,
  status        text not null default 'active'
                  constraint group_gifts_status_values check (status in ('active', 'closed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.contributions (
  id               uuid primary key default gen_random_uuid(),
  gift_id          uuid not null references public.group_gifts (id) on delete cascade,
  contributor_name text not null
                     constraint contributions_name_length check (char_length(btrim(contributor_name)) between 1 and 60),
  amount_paise     integer not null
                     constraint contributions_amount_range check (amount_paise between 1000 and 10000000), -- ₹10 to ₹1,00,000
  blessing         text not null default ''
                     constraint contributions_blessing_length check (char_length(blessing) <= 300),
  blessing_hidden  boolean not null default false,
  show_name        boolean not null default true,
  status           text not null default 'pledged'
                     constraint contributions_status_values check (status in ('pledged', 'marked_paid', 'confirmed', 'rejected')),
  source           text not null default 'upi'
                     constraint contributions_source_values check (source in ('upi', 'cash')),
  edit_token_hash  text
                     constraint contributions_token_hash_format check (edit_token_hash ~ '^[0-9a-f]{64}$'),
  confirmed_at     timestamptz,
  created_at       timestamptz not null default now(),
  -- UPI pledges always carry a token hash (the friend's proof); cash entries never do.
  constraint contributions_token_matches_source check ((source = 'upi') = (edit_token_hash is not null)),
  constraint contributions_confirmed_at_matches check ((status = 'confirmed') = (confirmed_at is not null))
);

create index if not exists group_gifts_owner_idx on public.group_gifts (owner_id, created_at desc);
create index if not exists contributions_gift_idx on public.contributions (gift_id, created_at desc);

drop trigger if exists group_gifts_touch on public.group_gifts;
create trigger group_gifts_touch
  before update on public.group_gifts
  for each row execute function public.touch_updated_at();

drop trigger if exists contributions_confirmed_at on public.contributions;
create trigger contributions_confirmed_at
  before insert or update of status on public.contributions
  for each row execute function public.set_confirmed_at();

-- -----------------------------------------------------------------------------
-- Privileges: start from nothing, then grant exactly what organisers need.
-- Column-level grants mean organisers can never read edit_token_hash or
-- change owner_id / slug, even on their own rows.
-- -----------------------------------------------------------------------------

revoke all on public.group_gifts, public.contributions from public, anon, authenticated;

grant select, delete on public.group_gifts to authenticated;
grant insert (couple_names, wedding_date, gift_title, gift_story, target_paise,
              organiser_name, organiser_upi, deadline, show_amounts)
  on public.group_gifts to authenticated;
grant update (couple_names, wedding_date, gift_title, gift_story, target_paise,
              organiser_name, organiser_upi, deadline, show_amounts, status)
  on public.group_gifts to authenticated;

grant select (id, gift_id, contributor_name, amount_paise, blessing, blessing_hidden,
              show_name, status, source, confirmed_at, created_at)
  on public.contributions to authenticated;
grant insert (gift_id, contributor_name, amount_paise, blessing, show_name, status, source)
  on public.contributions to authenticated;
grant update (status, blessing_hidden) on public.contributions to authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.group_gifts enable row level security;
alter table public.contributions enable row level security;

drop policy if exists "Organisers read their gifts" on public.group_gifts;
create policy "Organisers read their gifts" on public.group_gifts
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "Organisers create gifts" on public.group_gifts;
create policy "Organisers create gifts" on public.group_gifts
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists "Organisers edit their gifts" on public.group_gifts;
create policy "Organisers edit their gifts" on public.group_gifts
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "Organisers delete their gifts" on public.group_gifts;
create policy "Organisers delete their gifts" on public.group_gifts
  for delete to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "Organisers read contributions to their gifts" on public.contributions;
create policy "Organisers read contributions to their gifts" on public.contributions
  for select to authenticated
  using (exists (select 1 from public.group_gifts g where g.id = gift_id and g.owner_id = (select auth.uid())));

-- Organisers only ever add cash they received in person; it counts straight away.
drop policy if exists "Organisers add cash to their gifts" on public.contributions;
create policy "Organisers add cash to their gifts" on public.contributions
  for insert to authenticated
  with check (
    source = 'cash'
    and status = 'confirmed'
    and exists (select 1 from public.group_gifts g where g.id = gift_id and g.owner_id = (select auth.uid()))
  );

drop policy if exists "Organisers review contributions to their gifts" on public.contributions;
create policy "Organisers review contributions to their gifts" on public.contributions
  for update to authenticated
  using (exists (select 1 from public.group_gifts g where g.id = gift_id and g.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.group_gifts g where g.id = gift_id and g.owner_id = (select auth.uid())));

-- -----------------------------------------------------------------------------
-- Public functions (the only way in for friends who aren't signed in)
-- Errors are raised with stable codes the front end maps to friendly copy:
--   GIFT_NOT_FOUND, GIFT_CLOSED, DEADLINE_PASSED, GIFT_FULL, INVALID_TOKEN
-- -----------------------------------------------------------------------------

drop function if exists public.get_public_gift(text);
create function public.get_public_gift(p_slug text)
returns table (
  slug              text,
  couple_names      text,
  wedding_date      date,
  gift_title        text,
  gift_story        text,
  target_paise      bigint,
  organiser_name    text,
  organiser_upi     text,
  deadline          date,
  show_amounts      boolean,
  status            text,
  is_open           boolean,
  confirmed_paise   bigint,
  contributor_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    g.slug, g.couple_names, g.wedding_date, g.gift_title, g.gift_story, g.target_paise,
    g.organiser_name, g.organiser_upi, g.deadline, g.show_amounts, g.status,
    g.status = 'active' and (g.deadline is null or g.deadline >= public.today_ist()),
    coalesce(sum(c.amount_paise) filter (where c.status = 'confirmed'), 0)::bigint,
    (count(c.id) filter (where c.status = 'confirmed'))::integer
  from public.group_gifts g
  left join public.contributions c on c.gift_id = g.id
  where g.slug = lower(btrim(p_slug))
  group by g.id;
$$;

-- Blessings wall: friends who have paid (or say they have), newest first.
-- Names only if the friend allowed it; amounts only if the organiser allowed it
-- AND the money is confirmed; hidden blessings never leave the database.
drop function if exists public.get_public_blessings(text);
create function public.get_public_blessings(p_slug text)
returns table (
  name         text,
  amount_paise integer,
  blessing     text,
  created_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when c.show_name then c.contributor_name else 'A friend' end,
    case when g.show_amounts and c.status = 'confirmed' then c.amount_paise end,
    c.blessing,
    c.created_at
  from public.group_gifts g
  join public.contributions c on c.gift_id = g.id
  where g.slug = lower(btrim(p_slug))
    and c.status in ('marked_paid', 'confirmed')
    and not c.blessing_hidden
    and btrim(c.blessing) <> ''
  order by c.created_at desc
  limit 200;
$$;

-- A friend pledges. Returns the new id and a one-time secret token; only the
-- token's SHA-256 hash is stored, so the database alone can't act as the friend.
drop function if exists public.create_pledge(text, text, integer, text, boolean);
create function public.create_pledge(
  p_slug         text,
  p_name         text,
  p_amount_paise integer,
  p_blessing     text default '',
  p_show_name    boolean default true
)
returns table (contribution_id uuid, edit_token text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_gift  public.group_gifts%rowtype;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_id    uuid;
begin
  select * into v_gift from public.group_gifts g where g.slug = lower(btrim(p_slug));
  if not found then
    raise exception 'GIFT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_gift.status <> 'active' then
    raise exception 'GIFT_CLOSED' using errcode = 'P0001';
  end if;
  if v_gift.deadline is not null and v_gift.deadline < public.today_ist() then
    raise exception 'DEADLINE_PASSED' using errcode = 'P0001';
  end if;
  if (select count(*) from public.contributions c where c.gift_id = v_gift.id) >= 1000 then
    raise exception 'GIFT_FULL' using errcode = 'P0001';
  end if;

  insert into public.contributions
    (gift_id, contributor_name, amount_paise, blessing, show_name, status, source, edit_token_hash)
  values
    (v_gift.id, btrim(p_name), p_amount_paise, btrim(coalesce(p_blessing, '')), coalesce(p_show_name, true),
     'pledged', 'upi', encode(extensions.digest(v_token, 'sha256'), 'hex'))
  returning id into v_id;

  return query select v_id, v_token;
end;
$$;

-- "I've paid": pledged → marked_paid, only with the matching token. Safe to call twice.
drop function if exists public.mark_paid(uuid, text);
create function public.mark_paid(p_contribution_id uuid, p_token text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select c.status into v_status
  from public.contributions c
  where c.id = p_contribution_id
    and c.edit_token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
  for update;

  if not found then
    raise exception 'INVALID_TOKEN' using errcode = '28000';
  end if;

  if v_status = 'pledged' then
    update public.contributions set status = 'marked_paid' where id = p_contribution_id;
    v_status := 'marked_paid';
  end if;
  return v_status;
end;
$$;

-- Lets a friend's phone check on its own pledge ("Confirmed — thank you!").
drop function if exists public.get_my_pledge(uuid, text);
create function public.get_my_pledge(p_contribution_id uuid, p_token text)
returns table (status text, amount_paise integer, contributor_name text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select c.status, c.amount_paise, c.contributor_name, c.created_at
  from public.contributions c
  where c.id = p_contribution_id
    and c.edit_token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------

revoke all on function public.generate_slug() from public, anon, authenticated;
revoke all on function public.touch_updated_at() from public, anon, authenticated;
revoke all on function public.set_confirmed_at() from public, anon, authenticated;
revoke all on function public.today_ist() from public, anon, authenticated;
grant execute on function public.generate_slug() to authenticated; -- column default when an organiser creates a gift

revoke all on function public.get_public_gift(text) from public;
revoke all on function public.get_public_blessings(text) from public;
revoke all on function public.create_pledge(text, text, integer, text, boolean) from public;
revoke all on function public.mark_paid(uuid, text) from public;
revoke all on function public.get_my_pledge(uuid, text) from public;

grant execute on function public.get_public_gift(text) to anon, authenticated;
grant execute on function public.get_public_blessings(text) to anon, authenticated;
grant execute on function public.create_pledge(text, text, integer, text, boolean) to anon, authenticated;
grant execute on function public.mark_paid(uuid, text) to anon, authenticated;
grant execute on function public.get_my_pledge(uuid, text) to anon, authenticated;
