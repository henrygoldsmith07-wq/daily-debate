-- 036: guest practice loop carried through signup.
--
-- A guest who completes the practice loop (debate -> weakness -> repair ->
-- retest) has produced something worth keeping. The bounded summary is handed
-- to the signup form and stored on the new profile so the first account
-- experience starts from that result instead of zero. Write path validates
-- and bounds the payload before storing; rows are the user's own practice
-- summary, never free text from elsewhere.

alter table profiles
  add column if not exists guest_context jsonb;
