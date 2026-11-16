-- Web Push reminders (additive).
--
-- A learner who opts in from Today registers a browser push subscription. A
-- scheduled job (POST /api/push/dispatch) sends at most ONE push per learner
-- per day: a streak-saver in the early evening of a day they have not yet
-- practised, or a note that a repair is waiting to be tested (never naming
-- the skill under test — retestDisclosure.ts).
--
--   push_subscriptions — one row per browser endpoint. The endpoint and keys
--                        are what the browser's push service needs to deliver
--                        an encrypted message; deleted when the service says
--                        the subscription is gone (404/410) or on opt-out.
--   push_deliveries    — one row per push sent: kind and time, and when it
--                        was opened. The daily cap reads it; /analytics
--                        reports sent vs opened. No message text is stored.
--
-- Both cascade from profiles, so account erasure removes them.

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) <= 200),
  auth text not null check (length(auth) <= 100),
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0
);
create index if not exists push_subscriptions_user_idx on push_subscriptions(user_id);

create table if not exists push_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('streak', 'retest')),
  sent_at timestamptz not null default now(),
  opened_at timestamptz
);
create index if not exists push_deliveries_user_sent_idx on push_deliveries(user_id, sent_at desc);
