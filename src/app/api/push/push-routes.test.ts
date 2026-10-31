import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u-1" } as { id: string } | null,
  available: true,
  saved: [] as unknown[],
  deleted: [] as unknown[],
  opened: [] as string[],
  dispatched: 0,
}));

vi.mock("@/lib/backend/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } })),
}));
vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: vi.fn(async () => null),
  checkRateLimitKey: vi.fn(async () => ({ ok: true, remaining: 1, retryAfterSeconds: 0 })),
}));
vi.mock("@/lib/webPushServer", () => ({
  pushAvailable: () => h.available,
  saveSubscription: vi.fn(async (userId: string, sub: unknown) => {
    h.saved.push({ userId, sub });
  }),
  deleteSubscription: vi.fn(async (userId: string, endpoint: string | null) => {
    h.deleted.push({ userId, endpoint });
    return 1;
  }),
  markOpened: vi.fn(async (id: string) => {
    h.opened.push(id);
    return true;
  }),
  dispatchPushes: vi.fn(async () => {
    h.dispatched += 1;
    return { users: 1, sent: 1, skipped: 0, removed: 0, failed: 0 };
  }),
}));

import { DELETE, POST as subscribe } from "./subscription/route";
import { POST as opened } from "./opened/route";
import { POST as dispatch } from "./dispatch/route";

const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQ", auth: "tBHItJI5svbpez7KI4CCXg" },
};

beforeEach(() => {
  Object.assign(h, { user: { id: "u-1" }, available: true, saved: [], deleted: [], opened: [], dispatched: 0 });
  delete process.env.PUSH_DISPATCH_SECRET;
});

describe("POST /api/push/subscription", () => {
  it("saves a valid subscription for the signed-in learner", async () => {
    const res = await subscribe(json("/api/push/subscription", subscription));
    expect(res.status).toBe(200);
    expect(h.saved).toEqual([{ userId: "u-1", sub: { endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } }]);
  });

  it("refuses guests, an unconfigured server, and forged endpoints", async () => {
    h.user = null;
    expect((await subscribe(json("/api/push/subscription", subscription))).status).toBe(401);
    h.user = { id: "u-1" };
    h.available = false;
    expect((await subscribe(json("/api/push/subscription", subscription))).status).toBe(503);
    h.available = true;
    expect((await subscribe(json("/api/push/subscription", { ...subscription, endpoint: "https://attacker.example/x" }))).status).toBe(400);
    expect(h.saved).toHaveLength(0);
  });

  it("DELETE removes this browser, or every browser when no endpoint is given", async () => {
    await DELETE(new Request("http://localhost/api/push/subscription", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) }));
    await DELETE(new Request("http://localhost/api/push/subscription", { method: "DELETE" }));
    expect(h.deleted).toEqual([{ userId: "u-1", endpoint: subscription.endpoint }, { userId: "u-1", endpoint: null }]);
  });
});

describe("POST /api/push/opened", () => {
  it("records a click by delivery id and rejects anything else", async () => {
    const id = "6f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b";
    expect((await opened(json("/api/push/opened", { id }))).status).toBe(200);
    expect((await opened(json("/api/push/opened", { id: "'; drop table" }))).status).toBe(400);
    expect(h.opened).toEqual([id]);
  });
});

describe("POST /api/push/dispatch", () => {
  const secret = "s".repeat(40);

  it("does not exist without a configured secret", async () => {
    expect((await dispatch(json("/api/push/dispatch", {}, { authorization: `Bearer ${secret}` }))).status).toBe(404);
    process.env.PUSH_DISPATCH_SECRET = "too-short";
    expect((await dispatch(json("/api/push/dispatch", {}, { authorization: "Bearer too-short" }))).status).toBe(404);
    expect(h.dispatched).toBe(0);
  });

  it("runs only with the exact bearer secret", async () => {
    process.env.PUSH_DISPATCH_SECRET = secret;
    expect((await dispatch(json("/api/push/dispatch", {}, { authorization: `Bearer ${secret}x` }))).status).toBe(404);
    expect((await dispatch(json("/api/push/dispatch", {}))).status).toBe(404);
    const res = await dispatch(json("/api/push/dispatch", {}, { authorization: `Bearer ${secret}` }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: 1 });
    expect(h.dispatched).toBe(1);
  });
});
