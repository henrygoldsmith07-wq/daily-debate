-- Re-sync the product event allowlist with the application (additive: widens).
--
-- The CHECK constraint was last declared in 035. Since then the application
-- added weakness_feedback_missed, loop_streak_viewed, the four reminder_*
-- events (M16-M18) and weekly_recap_viewed (M20) to PRODUCT_EVENT_NAMES
-- without widening it, so every one of those inserts was rejected and
-- swallowed by the best-effort recorder: the reminder 24h cap (read back from
-- reminder_sent) never saw a send, and the analytics for those events have
-- been empty, not zero. This declares the full list again, plus result_shared
-- (shared result card). A unit test now fails whenever the TypeScript list and
-- the latest declaration here disagree.
--
-- Re-declaring the constraint replaces it in place; nothing is narrowed.

alter table product_events drop constraint if exists product_events_name_check; -- destructive-ok: re-declared immediately below as a strict superset (widening only)
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
    'weakness_feedback_missed', 'loop_streak_viewed', 'weekly_recap_viewed',
    'reminder_opted_in', 'reminder_opted_out', 'reminder_sent', 'reminder_acted',
    'result_shared'
  ));
