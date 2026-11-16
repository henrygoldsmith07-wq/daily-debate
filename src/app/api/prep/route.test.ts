import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  limited: false,
  prep: vi.fn(),
}));

vi.mock("@/lib/backend/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
}));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimitKey: async () => ({ ok: !h.limited }) }));
vi.mock("@/lib/motionPrepServer", () => ({ getMotionPrep: h.prep }));

import { GET } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const call = (id: string | null = ID) => GET(new Request(`http://x.test/api/prep${id ? `?topicId=${id}` : ""}`));

describe("GET /api/prep", () => {
  beforeEach(() => {
    h.user = { id: "u1" };
    h.limited = false;
    h.prep.mockReset();
  });

  it("serves prep for a signed-in learner", async () => {
    h.prep.mockResolvedValue({ for: { strongest: "a" }, against: { strongest: "b" } });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ prep: { for: { strongest: "a" } } });
    expect(h.prep).toHaveBeenCalledWith(ID);
  });

  it("refuses signed-out, rate-limited and malformed requests without generating", async () => {
    h.user = null;
    expect((await call()).status).toBe(401);
    h.user = { id: "u1" };
    h.limited = true;
    expect((await call()).status).toBe(429);
    h.limited = false;
    expect((await call("not-a-uuid")).status).toBe(400);
    expect((await call(null)).status).toBe(400);
    expect(h.prep).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown motion and 503 when generation fails", async () => {
    h.prep.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(404);
    h.prep.mockRejectedValueOnce(new Error("spend cap"));
    const res = await call();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/works without it/);
  });
});
