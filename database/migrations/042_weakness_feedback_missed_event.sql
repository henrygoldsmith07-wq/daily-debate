-- Allow the learner's "This feedback missed" flag on the result screen's
-- weakness card to be stored as a product event (no free text). Re-declares
-- the full allowlist from 035 so nothing is narrowed.
alter table product_events drop constraint if exists product_events_name_check;
alter table product_events
  add constraint product_events_name_check check (name in (
    'daily_viewed', 'debate_started', 'sprint_started', 'full_debate_started',
    'solo_debate_started',
    'round_completed', 'debate_completed',
    'repair_started', 'repair_attempted', 'repair_demonstrated',
    'repair_episode_closed', 'repair_completed',
    'retest_started', 'retest_completed', 'retest_skill_demonstrated',
    'full_analysis_opened', 'progress_viewed', 'pvp_started', 'challenge_me_selected',
    'challenge_link_created', 'challenge_link_accepted',
    'weakness_feedback_missed'
  ));
