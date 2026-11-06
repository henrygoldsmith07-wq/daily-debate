-- Today shows how many learners finished today's motion (copied from the
-- NYT Games / Wordle "N people played today"). That count reads
-- solo_debates by topic on every Today view; until now only (user_id,
-- created_at) and format were indexed, so it would scan the table.
--
-- Additive only: one partial index.

create index if not exists solo_debates_completed_topic_idx
  on solo_debates(topic_id, user_id) where status = 'completed';
