import test from "node:test";
import assert from "node:assert/strict";

import { checkMigrationPolicy, checkMigrationSet } from "./migration-policy.mjs";

test("additive migrations pass without any marker", () => {
  const additive = `
    alter table profiles add column if not exists guest_context jsonb;
    create table if not exists app_migrations (name text primary key);
    create unique index if not exists solo_debates_turn_idx on solo_debates (turn_id);
    alter table solo_debates add constraint solo_debates_format_check check (format in ('sprint','full')) not valid;
    alter table solo_debates validate constraint solo_debates_format_check;
    create or replace function complete_solo_debate_start(...) returns jsonb language sql as $$ select 1 $$;
  `;
  const result = checkMigrationPolicy(additive);
  assert.equal(result.destructive, false);
  assert.equal(result.allowed, true);
  assert.equal(result.markerReason, null);
});

test("DROP, RENAME and ALTER TYPE are flagged without the marker", () => {
  const cases = [
    ["drop table stale_rows;", "DROP"],
    ["alter table profiles drop column legacy_score;", "DROP"],
    ["alter table profiles rename column name to display_name;", "RENAME"],
    ["alter type debate_status rename to debate_state;", "ALTER TYPE (standalone)"],
    ["alter table solo_debates alter column format type text using format::text;", "ALTER TYPE (column)"],
  ];
  for (const [sql, rule] of cases) {
    const result = checkMigrationPolicy(sql);
    assert.equal(result.destructive, true, sql);
    // A statement can match several rules (e.g. ALTER TYPE ... RENAME);
    // assert the expected rule is among the findings, not first.
    assert.ok(
      result.findings.some((f) => f.rule === rule),
      `${sql} -> expected rule ${rule}, got ${result.findings.map((f) => f.rule).join(", ")}`,
    );
    assert.equal(result.allowed, false, sql);
  }
});

test("the destructive-ok marker with a reason allows the file", () => {
  const marked = `
    -- destructive-ok: legacy table unreferenced for 30 days (issue #55)
    drop table if exists stale_rows;
  `;
  const result = checkMigrationPolicy(marked);
  assert.equal(result.destructive, true);
  assert.equal(result.markerReason, "legacy table unreferenced for 30 days (issue #55)");
  assert.equal(result.allowed, true);
});

test("drop default and drop not-null are NOT destructive (normal contract-step tail)", () => {
  const result = checkMigrationPolicy(`
    alter table solo_debates alter column difficulty drop default;
    alter table solo_debates alter column difficulty drop not null;
  `);
  assert.equal(result.destructive, false);
  assert.equal(result.allowed, true);
});

test("marker detection is case-insensitive and accepts -- or /* */ comments", () => {
  assert.equal(checkMigrationPolicy("-- DESTRUCTIVE-OK: cleanup").markerReason, "cleanup");
  assert.equal(checkMigrationPolicy("/* destructive-ok: one-shot */ drop table t;").markerReason, "one-shot");
});

test("checkMigrationSet reports violations with file names and a hint", () => {
  const violations = checkMigrationSet([
    { name: "037_additive.sql", content: "alter table t add column c text;" },
    { name: "038_rename.sql", content: "alter table t rename column a to b;" },
  ]);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.name, "038_rename.sql");
  assert.equal(violations[0]?.rule, "RENAME");
  assert.match(violations[0]?.hint ?? "", /destructive-ok/);
});
