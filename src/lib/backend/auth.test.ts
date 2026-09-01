import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// The AuthApi imports "server-only" (aliased in vitest.config.mts) and the
// Neon-backed queryRows. These tests exercise the pure validation and
// delivery-decision logic without touching Postgres.

vi.mock("./sql", () => ({
  queryRows: vi.fn(),
}));

import { queryRows } from "./sql";
import {
  AuthApi,
  PASSWORD_RESET_TTL_SECONDS,
  type CookieStore,
  type ResetTokenSender,
} from "./auth";

const mockQueryRows = vi.mocked(queryRows);

function fakeCookieStore(): CookieStore {
  return {
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn(),
    delete: vi.fn(),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("PASSWORD_RESET_TTL_SECONDS", () => {
  it("gives users 30 minutes to complete the reset", () => {
    expect(PASSWORD_RESET_TTL_SECONDS).toBe(60 * 30);
  });
});

describe("requestPasswordReset validation", () => {
  it("rejects malformed emails without touching the database", async () => {
    mockQueryRows.mockClear();
    const api = new AuthApi(null);
    const { error } = await api.requestPasswordReset("not-an-email");
    expect(error?.message).toMatch(/valid email/i);
    expect(mockQueryRows).not.toHaveBeenCalled();
  });

  it("never reveals whether an email exists (non-enumeration)", async () => {
    mockQueryRows.mockReset();
    // Unknown email: no user row found.
    mockQueryRows.mockResolvedValue([]);
    const api = new AuthApi(null);
    const { error } = await api.requestPasswordReset("ghost@example.com");
    expect(error).toBeNull();
  });

  it("invalidates outstanding tokens before issuing a new one", async () => {
    mockQueryRows.mockReset();
    mockQueryRows.mockResolvedValue([{ id: "u-1" }]);
    const api = new AuthApi(null);
    await api.requestPasswordReset("user@example.com");
    const calls = mockQueryRows.mock.calls;
    // Call order: look up the user, invalidate outstanding tokens, insert the new token.
    expect(calls[0]![0]).toContain("SELECT id FROM app_users");
    expect(calls[1]![0]).toContain("DELETE FROM password_reset_tokens");
    expect(calls[2]![0]).toContain("INSERT INTO password_reset_tokens");
    // Stored hash is sha256 of the token, 64 hex chars.
    expect(String(calls[2]?.[1]?.[1])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("delivers the raw token through the configured sender only", async () => {
    mockQueryRows.mockReset();
    mockQueryRows.mockResolvedValue([{ id: "u-1" }]);
    const sent: { email: string; token: string }[] = [];
    const sender: ResetTokenSender = (email, token) => {
      sent.push({ email, token });
    };
    const api = new AuthApi(null, sender);
    await api.requestPasswordReset("user@example.com");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.email).toBe("user@example.com");
    expect(sent[0]?.token).toBeTruthy();
    // The stored hash must correspond to the delivered raw token.
    expect(String(mockQueryRows.mock.calls[2]?.[1]?.[1])).toBe(sha256(sent[0]?.token));
  });

  it("falls back to dev mode (console) when no sender is configured", async () => {
    mockQueryRows.mockReset();
    mockQueryRows.mockResolvedValue([{ id: "u-1" }]);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const api = new AuthApi(null);
    await api.requestPasswordReset("user@example.com");
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toContain("dev mode");
    info.mockRestore();
  });
});

describe("resetPassword validation", () => {
  it("rejects an empty token", async () => {
    mockQueryRows.mockReset();
    const api = new AuthApi(null);
    const { error } = await api.resetPassword({ token: "", newPassword: "longenough123" });
    expect(error?.message).toMatch(/token/i);
    expect(mockQueryRows).not.toHaveBeenCalled();
  });

  it("rejects short and over-long passwords without touching the database", async () => {
    mockQueryRows.mockReset();
    const api = new AuthApi(null);
    const short = await api.resetPassword({ token: "t", newPassword: "short" });
    const long = await api.resetPassword({ token: "t", newPassword: "x".repeat(129) });
    expect(short.error?.message).toMatch(/at least 8/i);
    expect(long.error?.message).toMatch(/128/);
    expect(mockQueryRows).not.toHaveBeenCalled();
  });

  it("reports a friendly error when the token does not resolve to a user", async () => {
    mockQueryRows.mockReset();
    // No row returned: token invalid, expired, or already consumed.
    mockQueryRows.mockResolvedValue([]);
    const api = new AuthApi(null);
    const { error } = await api.resetPassword({ token: "stale-token", newPassword: "newpassword1" });
    expect(error?.message).toMatch(/invalid or has expired/i);
  });

  it("hashes tokens with sha256 before lookup (same scheme as sessions)", async () => {
    mockQueryRows.mockReset();
    mockQueryRows.mockResolvedValue([{ id: "u-1", email: "user@example.com" }]);
    const api = new AuthApi(null);
    await api.resetPassword({ token: "raw-token-value", newPassword: "newpassword1" });
    expect(String(mockQueryRows.mock.calls[0]?.[1]?.[0])).toBe(sha256("raw-token-value"));
  });
});

describe("PASSWORD_RESET_TTL_SECONDS", () => {
  it("gives users 30 minutes to complete the reset", () => {
    expect(PASSWORD_RESET_TTL_SECONDS).toBe(60 * 30);
  });
});
