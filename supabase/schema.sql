-- =====================================================================
-- NexShot Championship Portal — Supabase schema (Phase 1)
-- Run this whole file once in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- Safe to re-run: every object is created with IF NOT EXISTS / OR REPLACE.
--
-- Security model:
--   * RLS is ON for every table and there are NO policies, so the public
--     anon key can read/write nothing. All access goes through the Vercel
--     API functions using the service_role key (kept only in Vercel env).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Settings (single row JSON document, edited from the admin panel)
-- ---------------------------------------------------------------------
create table if not exists app_settings (
  id          int primary key default 1 check (id = 1),
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
insert into app_settings (id, data) values (1, '{}'::jsonb) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2. Events / categories (match codes). Fee is decided HERE, never by the browser.
-- ---------------------------------------------------------------------
create table if not exists events (
  code         text primary key,
  event_group  text not null,             -- e.g. "ISSF 10M Air Rifle" (first dropdown)
  category     text not null,             -- e.g. "Youth Men (Under 19)"
  gender       text not null check (gender in ('Male','Female','All')),
  weapon       text not null check (weapon in ('Rifle','Pistol')),
  age_limit    text,
  shots        int  not null default 60 check (shots > 0),
  target       text,
  fee          int  not null check (fee >= 0),
  active       boolean not null default true,
  sort         int  not null default 0
);

-- ---------------------------------------------------------------------
-- 3. Relays (same relay timetable is used on every match day)
-- ---------------------------------------------------------------------
create table if not exists relays (
  relay_no        int primary key,
  name            text not null,
  type            text not null default 'NR',
  match_title     text,
  time_text       text not null,
  reporting_text  text not null,
  duration        text,
  capacity        int  not null default 15 check (capacity between 1 and 200),
  active          boolean not null default true
);

-- ---------------------------------------------------------------------
-- 4. Registrations
-- ---------------------------------------------------------------------
create sequence if not exists bib_seq start 101;

create table if not exists registrations (
  id              uuid primary key default gen_random_uuid(),
  reg_no          text unique,
  bib_no          int  unique,
  full_name       text not null,
  father_name     text,
  gender          text not null check (gender in ('Male','Female')),
  dob             date,
  phone           text not null,
  email           text,
  state           text,
  club_name       text,
  event_code      text references events(code) on update cascade,
  event_group     text,
  category        text,
  weapon          text,
  shots           int,
  match_date      date,
  relay_no        int,
  lane_no         int,
  fee             int  not null default 0,
  status          text not null default 'pending'
                  check (status in ('pending','paid','expired','failed','cancelled','refunded')),
  source          text not null default 'online' check (source in ('online','walkin','import','admin')),
  payment_mode    text,                    -- razorpay / cash / upi / free
  rzp_order_id    text unique,
  rzp_payment_id  text unique,
  paid_at         timestamptz,
  slot_issue      boolean not null default false,  -- paid but relay was full: admin must re-seat
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table registrations add column if not exists client_ip text;

create index if not exists registrations_phone_idx  on registrations (phone);
create index if not exists registrations_status_idx on registrations (status);
create index if not exists registrations_slot_idx   on registrations (match_date, relay_no);
-- One shooter per lane per relay per day (only for live seats)
create unique index if not exists registrations_lane_uniq
  on registrations (match_date, relay_no, lane_no)
  where status in ('pending','paid') and lane_no is not null;

-- ---------------------------------------------------------------------
-- 5. Scores / results (one row per registration)
-- ---------------------------------------------------------------------
create table if not exists scores (
  registration_id uuid primary key references registrations(id) on delete cascade,
  s1 numeric(5,1), s2 numeric(5,1), s3 numeric(5,1),
  s4 numeric(5,1), s5 numeric(5,1), s6 numeric(5,1),
  total numeric(6,1) generated always as (
    coalesce(s1,0)+coalesce(s2,0)+coalesce(s3,0)+coalesce(s4,0)+coalesce(s5,0)+coalesce(s6,0)
  ) stored,
  inner_tens   int not null default 0,
  final_score  numeric(6,1),
  status       text not null default 'pending'
               check (status in ('pending','shooting','finished','dns','dnf','dq')),
  rank_override int,
  remarks      text,
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 6. Logs
-- ---------------------------------------------------------------------
create table if not exists payment_events (
  id           bigserial primary key,
  source       text not null,              -- webhook / verify / reconcile
  event_type   text,
  order_id     text,
  payment_id   text,
  payload      jsonb,
  received_at  timestamptz not null default now()
);

create table if not exists admin_audit (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  action  text not null,
  detail  jsonb
);

-- ---------------------------------------------------------------------
-- 7. Lock everything down (no policies = anon/authenticated get nothing)
-- ---------------------------------------------------------------------
alter table app_settings   enable row level security;
alter table events         enable row level security;
alter table relays         enable row level security;
alter table registrations  enable row level security;
alter table scores         enable row level security;
alter table payment_events enable row level security;
alter table admin_audit    enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. Functions (called only by the server with service_role)
-- ---------------------------------------------------------------------

-- Lowest free lane in a relay on a day, or NULL when the relay is full.
create or replace function free_lane(p_date date, p_relay int)
returns int language plpgsql as $$
declare
  v_cap  int;
  v_lane int;
begin
  select capacity into v_cap from relays where relay_no = p_relay;
  if v_cap is null then return null; end if;
  select g into v_lane
    from generate_series(1, v_cap) g
   where not exists (
     select 1 from registrations r
      where r.match_date = p_date and r.relay_no = p_relay and r.lane_no = g
        and r.status in ('pending','paid'))
   order by g limit 1;
  return v_lane;
end $$;

-- Hold a seat for an online registration before payment (30 min hold).
-- Serialised per relay+day with an advisory lock, so two people can never get the same lane.
create or replace function reserve_registration(p jsonb)
returns registrations language plpgsql as $$
declare
  v_date  date := (p->>'match_date')::date;
  v_relay int  := (p->>'relay_no')::int;
  v_ev    events;
  v_rel   relays;
  v_lane  int;
  v_row   registrations;
begin
  select * into v_ev from events where code = p->>'event_code' and active;
  if not found then raise exception 'EVENT_NOT_AVAILABLE'; end if;
  if v_ev.gender <> 'All' and v_ev.gender <> p->>'gender' then raise exception 'GENDER_MISMATCH'; end if;

  select * into v_rel from relays where relay_no = v_relay and active;
  if not found then raise exception 'RELAY_NOT_AVAILABLE'; end if;

  perform pg_advisory_xact_lock(hashtext(v_date::text || '#' || v_relay::text));

  -- Release seats whose payment never finished
  update registrations set status = 'expired', updated_at = now()
   where status = 'pending' and source = 'online'
     and created_at < now() - interval '30 minutes';

  v_lane := free_lane(v_date, v_relay);
  if v_lane is null then raise exception 'RELAY_FULL'; end if;

  insert into registrations (
    full_name, father_name, gender, dob, phone, email, state, club_name,
    event_code, event_group, category, weapon, shots,
    match_date, relay_no, lane_no, fee, status, source, payment_mode, client_ip)
  values (
    p->>'full_name', nullif(p->>'father_name',''), p->>'gender', nullif(p->>'dob','')::date,
    p->>'phone', nullif(p->>'email',''), nullif(p->>'state',''), nullif(p->>'club_name',''),
    v_ev.code, v_ev.event_group, v_ev.category, v_ev.weapon, v_ev.shots,
    v_date, v_relay, v_lane, v_ev.fee, 'pending', 'online', 'razorpay', nullif(p->>'client_ip',''))
  returning * into v_row;

  return v_row;
end $$;

-- Mark a registration paid (idempotent). Assigns bib + reg no once.
-- If the held seat was lost (hold expired and someone took it), re-seat in the same
-- relay if possible, otherwise keep it paid and flag slot_issue for the admin.
create or replace function confirm_registration(p_id uuid, p_payment_id text, p_mode text default 'razorpay')
returns registrations language plpgsql as $$
declare
  v_row  registrations;
  v_lane int;
  v_bib  int;
begin
  select * into v_row from registrations where id = p_id for update;
  if not found then raise exception 'REGISTRATION_NOT_FOUND'; end if;

  if v_row.status = 'paid' then
    return v_row;  -- already confirmed (webhook + browser both call this)
  end if;

  if v_row.match_date is not null and v_row.relay_no is not null then
    perform pg_advisory_xact_lock(hashtext(v_row.match_date::text || '#' || v_row.relay_no::text));
    if v_row.lane_no is null or exists (
         select 1 from registrations r
          where r.id <> v_row.id and r.match_date = v_row.match_date
            and r.relay_no = v_row.relay_no and r.lane_no = v_row.lane_no
            and r.status in ('pending','paid')) then
      v_lane := free_lane(v_row.match_date, v_row.relay_no);
    else
      v_lane := v_row.lane_no;
    end if;
  end if;

  v_bib := coalesce(v_row.bib_no, nextval('bib_seq'));

  update registrations set
    status         = 'paid',
    payment_mode   = coalesce(p_mode, payment_mode),
    rzp_payment_id = coalesce(p_payment_id, rzp_payment_id),
    paid_at        = coalesce(paid_at, now()),
    bib_no         = v_bib,
    reg_no         = coalesce(reg_no, 'NSC-' || to_char(now(), 'YYYY') || '-' || v_bib),
    lane_no        = v_lane,
    slot_issue     = (v_row.relay_no is not null and v_lane is null),
    updated_at     = now()
  where id = p_id
  returning * into v_row;

  insert into scores (registration_id) values (v_row.id) on conflict do nothing;
  return v_row;
end $$;

-- Admin / walk-in / import entry: seat (if relay given) and confirm in one step.
create or replace function admin_create_registration(p jsonb)
returns registrations language plpgsql as $$
declare
  v_ev   events;
  v_date date := nullif(p->>'match_date','')::date;
  v_relay int := nullif(p->>'relay_no','')::int;
  v_lane int  := nullif(p->>'lane_no','')::int;
  v_row  registrations;
  v_status text := coalesce(nullif(p->>'status',''), 'paid');
  v_bib  int := nullif(p->>'bib_no','')::int;
begin
  select * into v_ev from events where code = p->>'event_code';
  if not found then raise exception 'UNKNOWN_EVENT_CODE %', p->>'event_code'; end if;

  if v_date is not null and v_relay is not null then
    perform pg_advisory_xact_lock(hashtext(v_date::text || '#' || v_relay::text));
    if v_lane is null or exists (
        select 1 from registrations r where r.match_date = v_date and r.relay_no = v_relay
          and r.lane_no = v_lane and r.status in ('pending','paid')) then
      v_lane := free_lane(v_date, v_relay);
    end if;
  else
    v_lane := null;
  end if;

  insert into registrations (
    full_name, father_name, gender, dob, phone, email, state, club_name,
    event_code, event_group, category, weapon, shots,
    match_date, relay_no, lane_no, fee, status, source, payment_mode, notes, bib_no)
  values (
    p->>'full_name', nullif(p->>'father_name',''), p->>'gender', nullif(p->>'dob','')::date,
    p->>'phone', nullif(p->>'email',''), nullif(p->>'state',''), nullif(p->>'club_name',''),
    v_ev.code, v_ev.event_group, v_ev.category, v_ev.weapon, v_ev.shots,
    v_date, v_relay, v_lane,
    coalesce(nullif(p->>'fee','')::int, v_ev.fee),
    case when v_status = 'paid' then 'pending' else v_status end,
    coalesce(nullif(p->>'source',''), 'admin'),
    coalesce(nullif(p->>'payment_mode',''), 'cash'),
    nullif(p->>'notes',''), v_bib)
  returning * into v_row;

  if v_status = 'paid' then
    v_row := confirm_registration(v_row.id, null, coalesce(nullif(p->>'payment_mode',''), 'cash'));
  end if;
  return v_row;
end $$;

-- Public, PII-free results view used by /api/scores
create or replace view public_results with (security_invoker = true) as
select r.bib_no, r.reg_no, r.full_name, r.club_name, r.gender,
       r.event_code, r.event_group, r.category, r.weapon, r.shots,
       r.match_date, r.relay_no, r.lane_no,
       s.s1, s.s2, s.s3, s.s4, s.s5, s.s6, s.total, s.inner_tens, s.final_score,
       s.status, s.rank_override, s.remarks, s.updated_at
  from registrations r
  join scores s on s.registration_id = r.id
 where r.status = 'paid';

revoke all on public_results from anon, authenticated;

-- Seat counts per relay for a day (online form shows "x / 15 available")
create or replace function relay_occupancy(p_date date)
returns table (relay_no int, taken int) language sql stable as $$
  select r.relay_no, count(*)::int
    from registrations r
   where r.match_date = p_date and r.status in ('pending','paid')
     and (r.status = 'paid' or r.created_at > now() - interval '30 minutes')
   group by r.relay_no
$$;

-- After a restore/import with explicit bib numbers, move the bib counter past the highest bib.
create or replace function sync_bib_seq()
returns int language sql as $$
  select setval('bib_seq', greatest((select coalesce(max(bib_no), 100) from registrations), 100))::int
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
