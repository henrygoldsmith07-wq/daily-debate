import { test } from "node:test";
import assert from "node:assert/strict";
import { isNeonHttpUrl, isTransactionCapableUrl } from "./sql-executor.mjs";

const NEON_POOLER = "postgresql://user:pw@ep-spring-water-xyz-pooler.c-2.eu-west-2.aws.neon.tech/neondb?sslmode=require";

test("a Neon postgres:// pooler URL can hold a transaction (the corpus-repair refusal)", () => {
  delete process.env.DATABASE_DRIVER;
  assert.equal(isTransactionCapableUrl(NEON_POOLER), true);
  assert.equal(isTransactionCapableUrl("postgres://postgres@localhost:5432/app"), true);
});

test("an https (Neon HTTP) URL, a malformed URL, or the neon-http driver cannot", () => {
  delete process.env.DATABASE_DRIVER;
  assert.equal(isTransactionCapableUrl("https://ep-x.neon.tech/sql"), false);
  assert.equal(isTransactionCapableUrl("not a url"), false);
  process.env.DATABASE_DRIVER = "neon-http";
  try {
    assert.equal(isTransactionCapableUrl("postgres://postgres@localhost:5432/app"), false);
  } finally {
    delete process.env.DATABASE_DRIVER;
  }
});

test("isNeonHttpUrl is unchanged: it still flags every Neon host for driver selection", () => {
  delete process.env.DATABASE_DRIVER;
  assert.equal(isNeonHttpUrl(NEON_POOLER), true);
  assert.equal(isNeonHttpUrl("postgres://postgres@localhost:5432/app"), false);
});
