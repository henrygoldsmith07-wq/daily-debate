-- Daily coaching loop, Sprint format, weak-link repair persistence,
-- asynchronous friend challenges, and privacy-conscious product events.

-- Solo debates gain a format (sprint vs full) and a coaching snapshot so the
-- daily goal loop survives across sessions without re-deriving it.
alter table solo_debates
  add column if not exists format text not null default 'full'
    check (format in ('sprint', 'full')),
  add column if not exists coaching jsonb;

create index if not exists solo_debates_format_idx on solo_debates(format);

-- Weak-link repair outcomes: one row per completed repair exercise so the
-- funnel (started → completed → succeeded) is measurable and the coaching
-- system can react to what the user actually practised.
create table if not exists repair_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  debate_id uuid not null references solo_debates(id) on delete cascade,
  target_kind text not null check (target_kind in ('evidence', 'rebuttal', 'logic', 'impact', 'structure', 'clarity')),
  source_node_id text,
  source_text text not null,
  rewrite_text text not null check (char_length(rewrite_text) between 1 and 2000),
  score integer not null check (score between 0 and 100),
  succeeded boolean not null,
  signals jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists repair_results_user_idx on repair_results(user_id, created_at desc);
create index if not exists repair_results_debate_idx on repair_results(debate_id);

-- Asynchronous friend challenges: a pre-created PvP match with a shareable
-- invite code. Both players take turns whenever they like; match state, turn
-- state, and the replayable transcript live in the existing pvp tables.
create table if not exists challenge_invites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (char_length(code) between 6 and 32),
  challenger_id uuid not null references profiles(id) on delete cascade,
  topic_id uuid not null references daily_topics(id),
  challenger_side text not null check (challenger_side in ('for', 'against')),
  status text not null default 'open' check (status in ('open', 'accepted', 'expired', 'cancelled')),
  opponent_id uuid references profiles(id),
  match_id uuid references pvp_matches(id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists challenge_invites_code_idx on challenge_invites(code);
create index if not exists challenge_invites_challenger_idx on challenge_invites(challenger_id, created_at desc);

-- Product funnel events. No free text, no transcript content, no session or
-- device identifiers — just the event name, bounded context, and the user it
-- happened to (null rows are never inserted; guests are skipped server-side).
create table if not exists product_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null check (name in (
    'daily_viewed', 'debate_started', 'sprint_started', 'full_debate_started',
    'round_completed', 'debate_completed', 'repair_started', 'repair_completed',
    'full_analysis_opened', 'progress_viewed', 'pvp_started', 'challenge_me_selected',
    'challenge_link_created', 'challenge_link_accepted'
  )),
  format text check (format in ('sprint', 'full')),
  side text check (side in ('for', 'against')),
  reason text,
  round integer,
  repair_score integer,
  created_at timestamptz not null default now()
);
create index if not exists product_events_user_idx on product_events(user_id, created_at desc);
create index if not exists product_events_name_idx on product_events(name, created_at desc);
