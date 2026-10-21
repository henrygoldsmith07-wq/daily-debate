import { describe, expect, it } from "vitest";

import { isAdminAccount } from "./adminAccess";

/**
 * ADMIN AUTHORIZATION (two factors).
 *
 * The admin gate used to compare the request's email against the
 * CORPUS_ADMIN_EMAILS allowlist and nothing else. Because `app_users.email`
 * is asserted by the person signing up and this codebase never verifies
 * mailboxes, that made every admin surface a self-registration target:
 * registering an allowlisted address that had no account yet granted admin
 * over the corpus, the ops report and the product funnel — and locked the
 * legitimate administrator out, because `app_users.email` is UNIQUE.
 *
 * Admin now needs BOTH the operator-granted database role
 * (`app_users.is_admin`) and the allowlist. These tests pin that neither
 * factor alone is enough, and that the gate fails closed.
 */

const ALLOWLIST = "admin@example.com, second@example.com";

describe("isAdminAccount", () => {
  it("grants admin only when the database role AND the allowlist agree", () => {
    expect(isAdminAccount({ email: "admin@example.com", isAdmin: true }, ALLOWLIST)).toBe(true);
  });

  it("denies a self-registered allowlisted address with no database role", () => {
    // The exact attack: the email is on the allowlist, but nobody granted the
    // role, so registering that address must not confer admin.
    expect(isAdminAccount({ email: "admin@example.com", isAdmin: false }, ALLOWLIST)).toBe(false);
  });

  it("denies a granted role whose address is not on the allowlist", () => {
    expect(isAdminAccount({ email: "stranger@example.com", isAdmin: true }, ALLOWLIST)).toBe(false);
  });

  it("denies when the allowlist is missing or empty", () => {
    expect(isAdminAccount({ email: "admin@example.com", isAdmin: true }, undefined)).toBe(false);
    expect(isAdminAccount({ email: "admin@example.com", isAdmin: true }, "")).toBe(false);
    expect(isAdminAccount({ email: "admin@example.com", isAdmin: true }, "  ,  ")).toBe(false);
  });

  it("denies when there is no identity at all", () => {
    expect(isAdminAccount(null, ALLOWLIST)).toBe(false);
    expect(isAdminAccount(undefined, ALLOWLIST)).toBe(false);
  });

  it("matches the allowlist case-insensitively and ignores whitespace in the allowlist", () => {
    // The allowlist entries are trimmed; the address itself is normalised
    // (trimmed + lowercased) when the account is created, so a padded
    // address never reaches the gate.
    expect(isAdminAccount({ email: "ADMIN@example.com", isAdmin: true }, ALLOWLIST)).toBe(true);
    expect(isAdminAccount({ email: "second@example.com", isAdmin: true }, "  admin@example.com ,  second@example.com  ")).toBe(
      true,
    );
  });

  it("never accepts a role flag that is not exactly true", () => {
    // A missing or truthy-but-not-true flag must not pass the gate.
    expect(isAdminAccount({ email: "admin@example.com", isAdmin: false }, ALLOWLIST)).toBe(false);
    expect(
      isAdminAccount({ email: "admin@example.com" } as unknown as { email: string; isAdmin: boolean }, ALLOWLIST),
    ).toBe(false);
  });
});
