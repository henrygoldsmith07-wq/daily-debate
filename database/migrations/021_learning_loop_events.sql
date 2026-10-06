-- Give each learning-loop event one meaning. Keep repair_completed for legacy
-- rows, but new writes distinguish attempted practice, prompted demonstration,
-- episode closure, and later debate retests.

alter table product_events
  drop constraint if exists product_events_name_check;

alter table product_events
  add constraint product_events_name_check check (name in (
    'daily_viewed', 'debate_started', 'sprint_started', 'full_debate_started',
    'round_completed', 'debate_completed',
    'repair_started', 'repair_attempted', 'repair_demonstrated',
    'repair_episode_closed', 'repair_completed',
    'retest_started', 'retest_completed', 'retest_skill_demonstrated',
    'full_analysis_opened', 'progress_viewed', 'pvp_started', 'challenge_me_selected',
    'challenge_link_created', 'challenge_link_accepted'
  ));
