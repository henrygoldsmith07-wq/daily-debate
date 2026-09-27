alter table solo_debate_turns
  add column if not exists training_meta jsonb;

