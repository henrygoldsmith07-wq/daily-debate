import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1", email: "a@b.co" } as { id: string; email?: string | null } | null,
  limit: { ok: true, retryAfterSeconds: 0 },
  signIn: { error: null as unknown, data: { user: { id: "u1" } as { id: string } | null } },
  rpc: { data: { debates: 2 } as unknown, error: null as unknown },
  signOutThrows: false,
  calls: [] as string[],
}));

vi.mock("@/lib/backend/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: h.user } }),
      signInWithPassword: async () => {
        h.calls.push("signIn");
        return h.signIn;
      },
      signOut: async () => {
        h.calls.push("signOut");
        if (h.signOutThrows) throw new Error("cookie store unavailable");
      },
    },
    rpc: async (name: string) => {
      h.calls.push(name);
      return h.rpc;
    },
  }),
}));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimitKey: async () => h.limit }));

import { DELETE } from "./route";

const del = (body: unknown) =>
  DELETE(new Request("http://t/api/account", { method: "DELETE", body: typeof body === "string" ? body : JSON.stringify(body) }));

describe("DELETE /api/account", () => {
  beforeEach(() => {
    h.user = { id: "u1", email: "a@b.co" };
    h.limit = { ok: true, retryAfterSeconds: 0 };
    h.signIn = { error: null, data: { user: { id: "u1" } } };
    h.rpc = { data: { debates: 2 }, error: null };
    h.signOutThrows = false;
    h.calls = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("401s signed-out callers", async () => {
    h.user = null;
    expect((await del({ confirm: "DELETE", password: "x" })).status).toBe(401);
    expect(h.calls).toEqual([]);
  });

  it("429s with Retry-After when limited", async () => {
    h.limit = { ok: false, retryAfterSeconds: 9 };
    const res = await del({ confirm: "DELETE", password: "x" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("9");
  });

  it.each([
    [{ confirm: "delete", password: "x" }, "confirm_required"],
    ["not json", "confirm_required"],
    [{ confirm: "DELETE" }, "password_required"],
  ])("400s %j without deleting", async (body, code) => {
    const res = await del(body);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe(code);
    expect(h.calls).toEqual([]);
  });

  it("refuses a wrong password and deletes nothing", async () => {
    h.signIn = { error: { message: "bad" }, data: { user: null } };
    const res = await del({ confirm: "DELETE", password: "x" });
    expect(res.status).toBe(401);
    expect(h.calls).not.toContain("delete_app_account");
  });

  it("refuses when the session has no email", async () => {
    h.user = { id: "u1", email: null };
    expect((await del({ confirm: "DELETE", password: "x" })).status).toBe(401);
    expect(h.calls).toEqual([]);
  });

  it("refuses a password that authenticates a different user", async () => {
    h.signIn = { error: null, data: { user: { id: "other" } } };
    expect((await del({ confirm: "DELETE", password: "x" })).status).toBe(401);
    expect(h.calls).not.toContain("delete_app_account");
  });

  it("reports failure and keeps the session when the rpc errors", async () => {
    h.rpc = { data: null, error: { message: "boom" } };
    const res = await del({ confirm: "DELETE", password: "x" });
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("deletion_failed");
    expect(h.calls).not.toContain("signOut");
  });

  it("deletes, then signs out", async () => {
    const res = await del({ confirm: "DELETE", password: "x" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, summary: { debates: 2 } });
    expect(h.calls).toEqual(["signIn", "delete_app_account", "signOut"]);
  });

  it("still reports success when sign-out throws after the account is gone", async () => {
    h.signOutThrows = true;
    const res = await del({ confirm: "DELETE", password: "x" });
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(true);
  });
});
