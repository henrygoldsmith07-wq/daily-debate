-- Daily Debate owned backend. Standard PostgreSQL; no platform-specific auth,
-- row-level-security helpers, realtime publications, or service roles.

create extension if not exists pgcrypto;

create table if not exists app_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists app_sessions_user_idx on app_sessions(user_id);
create index if not exists app_sessions_expiry_idx on app_sessions(expires_at);

create table if not exists profiles (
  id uuid primary key references app_users(id) on delete cascade,
  username text unique,
  total_points integer not null default 0,
  level integer not null default 1,
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  last_activity_date date,
  created_at timestamptz not null default now()
);

create table if not exists daily_topics (
  id uuid primary key default gen_random_uuid(),
  topic_date date not null unique,
  title text not null,
  prompt text not null,
  category text,
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists solo_debates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  topic_id uuid not null references daily_topics(id),
  side text not null check (side in ('for', 'against')),
  status text not null default 'active' check (status in ('active', 'completed')),
  round_count integer not null default 0,
  total_score integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists solo_debates_user_idx on solo_debates(user_id, created_at desc);

create table if not exists solo_debate_turns (
  id uuid primary key default gen_random_uuid(),
  debate_id uuid not null references solo_debates(id) on delete cascade,
  round_number integer not null,
  ai_message text not null,
  user_message text,
  input_mode text not null default 'text' check (input_mode in ('text', 'voice')),
  scores jsonb,
  turn_score integer,
  feedback text,
  assessment jsonb,
  created_at timestamptz not null default now()
);
create index if not exists solo_turns_debate_idx on solo_debate_turns(debate_id, round_number);

create table if not exists pvp_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references profiles(id) on delete cascade,
  topic_id uuid not null references daily_topics(id),
  joined_at timestamptz not null default now()
);

create table if not exists pvp_matches (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references daily_topics(id),
  player_a uuid not null references profiles(id),
  player_b uuid not null references profiles(id),
  player_a_side text not null check (player_a_side in ('for', 'against')),
  status text not null default 'active' check (status in ('active', 'completed')),
  round_limit integer not null default 5,
  current_round integer not null default 1,
  current_turn_player uuid references profiles(id),
  turn_started_at timestamptz,
  winner_id uuid references profiles(id),
  judge_verdict jsonb,
  judge_fingerprint jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists pvp_matches_player_a_idx on pvp_matches(player_a, created_at desc);
create index if not exists pvp_matches_player_b_idx on pvp_matches(player_b, created_at desc);
create index if not exists pvp_matches_fingerprint_idx on pvp_matches using gin(judge_fingerprint);

create table if not exists pvp_turns (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references pvp_matches(id) on delete cascade,
  player_id uuid not null references profiles(id),
  round_number integer not null,
  message text not null,
  input_mode text not null default 'text' check (input_mode in ('text', 'voice')),
  created_at timestamptz not null default now(),
  unique (match_id, player_id, round_number)
);
create index if not exists pvp_turns_match_idx on pvp_turns(match_id, created_at);

create table if not exists rate_limits (
  key text primary key,
  count integer not null default 1,
  reset_at timestamptz not null
);

create table if not exists benchmark_corpus (
  id text primary key,
  transcript text not null,
  human_winner text not null check (human_winner in ('a', 'b', 'tie')),
  rater_verdicts jsonb not null default '[]'::jsonb,
  rater_ids text[] not null default '{}',
  human_rationale text not null default '',
  topic text,
  is_synthetic boolean not null default false,
  provenance text not null default 'unverified_repository_fixture'
    check (provenance in ('verified_human', 'unverified_repository_fixture', 'synthetic')),
  provenance_record jsonb,
  created_at timestamptz not null default now()
);

create table if not exists match_appeals (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references pvp_matches(id) on delete cascade,
  filed_by uuid not null references profiles(id) on delete cascade,
  reason text not null check (reason in ('scoring_error', 'missed_evidence', 'bias', 'abuse', 'other')),
  note text not null check (char_length(note) between 20 and 600),
  status text not null default 'open' check (status in ('open', 'under_review', 'upheld', 'denied', 'withdrawn')),
  corrected_winner text check (corrected_winner in ('a', 'b', 'tie')),
  resolution_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references profiles(id) on delete cascade,
  match_id uuid references pvp_matches(id) on delete set null,
  filed_by uuid not null references profiles(id) on delete cascade,
  reason text not null check (reason in ('harassment', 'spam', 'cheating', 'impersonation', 'other')),
  note text not null check (char_length(note) between 1 and 600),
  created_at timestamptz not null default now()
);

create table if not exists corpus_items (
  id uuid primary key default gen_random_uuid(),
  transcript text not null,
  topic text,
  source_type text not null check (source_type in ('solo', 'pvp')),
  source_id uuid,
  contributor_id uuid not null references profiles(id),
  side_mapping jsonb not null default '{}'::jsonb,
  length_bucket text not null check (length_bucket in ('short', 'medium', 'long')),
  subject_category text,
  ability_band text not null check (ability_band in ('novice', 'intermediate', 'advanced')),
  topic_id uuid,
  topic_title text not null default '',
  topic_prompt text not null default '',
  status text not null default 'open' check (status in ('open', 'rated', 'adjudicated', 'rejected')),
  dynamics_tier text check (dynamics_tier in ('close', 'decisive', 'weak_vs_weak')),
  evidence_density text check (evidence_density in ('evidence_heavy', 'balanced', 'evidence_light')),
  style_bucket text check (style_bucket in ('formal', 'hedged', 'plain', 'intense')),
  split text not null default 'development' check (split in ('development', 'validation', 'locked')),
  created_at timestamptz not null default now()
);
create index if not exists corpus_items_dynamics_idx on corpus_items(dynamics_tier);
create index if not exists corpus_items_evidence_idx on corpus_items(evidence_density);
create index if not exists corpus_items_style_idx on corpus_items(style_bucket);
create index if not exists corpus_items_split_idx on corpus_items(split);

create table if not exists corpus_ratings (
  id uuid primary key default gen_random_uuid(),
  corpus_id uuid not null references corpus_items(id) on delete cascade,
  rater_id uuid not null references profiles(id),
  scores_a jsonb not null,
  scores_b jsonb not null,
  winner text not null check (winner in ('a', 'b', 'tie')),
  confidence numeric check (confidence between 0 and 1),
  rationale text not null default '',
  created_at timestamptz not null default now(),
  unique (corpus_id, rater_id)
);

create table if not exists drill_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  dimension text not null check (dimension in ('evidence', 'rebuttal', 'logic', 'clarity', 'impact', 'steelmanning', 'structure')),
  minutes integer not null default 3 check (minutes between 2 and 5),
  title text not null,
  prompt text not null,
  assigned_date date not null default current_date,
  before_score numeric check (before_score between 0 and 100),
  attempt_text text,
  attempt_score numeric check (attempt_score between 0 and 100),
  movement numeric,
  status text not null default 'open' check (status in ('open', 'attempted')),
  created_at timestamptz not null default now(),
  unique (user_id, assigned_date)
);

create table if not exists topic_evidence (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references daily_topics(id) on delete cascade,
  claim text not null,
  source_name text not null,
  source_type text not null check (source_type in ('primary', 'news', 'secondary', 'tertiary')),
  url text not null,
  title text,
  passage text not null,
  published_date date,
  checks jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (topic_id, url)
);

create table if not exists judge_health_log (
  id uuid primary key default gen_random_uuid(),
  judge_id text not null,
  date date not null default current_date,
  position_mirror_stability numeric not null check (position_mirror_stability between 0 and 1),
  verbosity_stability numeric not null check (verbosity_stability between 0 and 1),
  human_agreement numeric not null check (human_agreement between 0 and 1),
  ece numeric not null,
  false_citation_influence numeric not null check (false_citation_influence between 0 and 1),
  gates_passed boolean not null default false,
  retired boolean not null default false,
  retirement_reason text,
  created_at timestamptz not null default now(),
  unique (judge_id, date)
);

create or replace function increment_rate_limit(p_key text, p_window_ms integer)
returns table (new_count integer, new_reset_at timestamptz)
language sql
as $$
  insert into rate_limits (key, count, reset_at)
  values (p_key, 1, now() + make_interval(secs => p_window_ms / 1000.0))
  on conflict (key) do update
    set count = case when rate_limits.reset_at <= now() then 1 else rate_limits.count + 1 end,
        reset_at = case
          when rate_limits.reset_at <= now() then now() + make_interval(secs => p_window_ms / 1000.0)
          else rate_limits.reset_at end
  returning rate_limits.count, rate_limits.reset_at;
$$;

create or replace function increment_total_points(
  p_user_id uuid,
  p_points integer,
  p_points_per_level integer
)
returns integer
language sql
as $$
  update profiles
  set total_points = profiles.total_points + p_points,
      level = floor((profiles.total_points + p_points) / greatest(p_points_per_level, 1)) + 1
  where id = p_user_id
  returning profiles.total_points;
$$;

create or replace function cleanup_expired_backend_state()
returns void
language plpgsql
as $$
begin
  delete from app_sessions where expires_at <= now();
  delete from rate_limits where reset_at <= now();
end;
$$;
