-- 017: persistent judge-avoidance route lifecycle registry.
--
-- Route states must be deliberate and durable, never derived from a pure
-- function alone: promotion to `adopted` is a manual act recorded here with
-- its evidence, and an adopted route that later violates its monitoring gate
-- is returned here to `suspended` so production fails safe to the ensemble.
-- All routes default to `shadow` (absence of a row means shadow, never
-- adopted). No serving path may route production traffic on this table alone;
-- the established ensemble remains authoritative until a deliberate adoption.

create table if not exists route_lifecycle (
  route text primary key,
  registration_version text not null,
  state text not null default 'shadow'
    check (state in ('shadow', 'eligible', 'adopted', 'suspended')),
  evaluated_at timestamptz,
  sample_window text,
  sample_n integer,
  gate_result jsonb,
  human_result jsonb,
  adopted_at timestamptz,
  suspended_at timestamptz,
  reason text,
  updated_at timestamptz not null default now()
);
