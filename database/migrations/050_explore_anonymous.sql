-- Explore: publish a solo debate without your username (copied from Kialo
-- Edu's anonymous participation, which it offers to ease the worry of
-- arguing in public).
--
-- A learner who publishes anonymously appears on Explore, on the debate page
-- and in its metadata as "A debater", the same fallback name an account
-- without a username already gets. Reports, votes and takedown are
-- unchanged: they key on the debate, and the server still knows the owner.
--
-- Additive only: one column with a default, so existing published debates
-- keep showing their username.

alter table solo_debates add column if not exists published_anonymously boolean not null default false;
