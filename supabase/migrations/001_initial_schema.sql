-- Daily Debate: schema for solo AI debates, player-vs-player debates, and
-- the gamified scoring/streak/leaderboard system.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique,
  total_points integer not null default 0,
  level integer not null default 1,
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  last_activity_date date,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Profiles are readable by any signed-in user (leaderboard), but only the
-- owner can create/update their own row.
create policy "Profiles are readable by authenticated users." on public.profiles
  for select using (auth.role() = 'authenticated');
create policy "Users can insert their own profile." on public.profiles
  for insert with check (auth.uid() = id);
create policy "Users can update their own profile." on public.profiles
  for update using (auth.uid() = id);

-- Auto-create a profile row whenever a new auth user signs up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- daily_topics
-- ---------------------------------------------------------------------------
create table public.daily_topics (
  id uuid primary key default gen_random_uuid(),
  topic_date date not null unique,
  title text not null,
  prompt text not null,
  category text,
  sources jsonb not null default '[]',
  created_at timestamptz not null default now()
);

alter table public.daily_topics enable row level security;

create policy "Daily topics are readable by authenticated users." on public.daily_topics
  for select using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- solo_debates + solo_debate_turns (user vs AI)
-- ---------------------------------------------------------------------------
create table public.solo_debates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  topic_id uuid not null references public.daily_topics (id),
  side text not null check (side in ('for', 'against')),
  status text not null default 'active' check (status in ('active', 'completed')),
  round_count integer not null default 0,
  total_score integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.solo_debates enable row level security;

create policy "Users manage their own solo debates." on public.solo_debates
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.solo_debate_turns (
  id uuid primary key default gen_random_uuid(),
  debate_id uuid not null references public.solo_debates (id) on delete cascade,
  round_number integer not null,
  ai_message text not null,
  user_message text,
  input_mode text not null default 'text' check (input_mode in ('text', 'voice')),
  scores jsonb,
  turn_score integer,
  feedback text,
  created_at timestamptz not null default now()
);

alter table public.solo_debate_turns enable row level security;

create policy "Users manage turns of their own solo debates." on public.solo_debate_turns
  for all using (
    exists (
      select 1 from public.solo_debates d
      where d.id = solo_debate_turns.debate_id and d.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.solo_debates d
      where d.id = solo_debate_turns.debate_id and d.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- pvp_queue, pvp_matches, pvp_turns (user vs user)
-- ---------------------------------------------------------------------------
create table public.pvp_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  topic_id uuid not null references public.daily_topics (id),
  joined_at timestamptz not null default now()
);

alter table public.pvp_queue enable row level security;

create policy "Users manage their own queue entry." on public.pvp_queue
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.pvp_matches (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.daily_topics (id),
  player_a uuid not null references public.profiles (id),
  player_b uuid not null references public.profiles (id),
  player_a_side text not null check (player_a_side in ('for', 'against')),
  status text not null default 'active' check (status in ('active', 'completed')),
  round_limit integer not null default 5,
  current_round integer not null default 1,
  current_turn_player uuid references public.profiles (id),
  winner_id uuid references public.profiles (id),
  judge_verdict jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.pvp_matches enable row level security;

create policy "Participants can read their match." on public.pvp_matches
  for select using (auth.uid() = player_a or auth.uid() = player_b);
create policy "Participants can update their match." on public.pvp_matches
  for update using (auth.uid() = player_a or auth.uid() = player_b);

create table public.pvp_turns (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.pvp_matches (id) on delete cascade,
  player_id uuid not null references public.profiles (id),
  round_number integer not null,
  message text not null,
  input_mode text not null default 'text' check (input_mode in ('text', 'voice')),
  created_at timestamptz not null default now()
);

alter table public.pvp_turns enable row level security;

create policy "Participants can read turns of their match." on public.pvp_turns
  for select using (
    exists (
      select 1 from public.pvp_matches m
      where m.id = pvp_turns.match_id and (m.player_a = auth.uid() or m.player_b = auth.uid())
    )
  );
create policy "Participants can insert their own turns." on public.pvp_turns
  for insert with check (
    auth.uid() = player_id
    and exists (
      select 1 from public.pvp_matches m
      where m.id = pvp_turns.match_id and (m.player_a = auth.uid() or m.player_b = auth.uid())
    )
  );

-- Realtime for live PvP rooms.
alter publication supabase_realtime add table public.pvp_turns;
alter publication supabase_realtime add table public.pvp_matches;
