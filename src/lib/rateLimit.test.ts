import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  __localRateLimitForTests,
  __clearBucketsForTests,
  checkRateLimitKey,
  clientIpFromHeaders,
  getClientIp,
} from "./rateLimit";

// Simulate a configured-but-unreachable shared limiter: the distributed
// branch is taken, then the client construction fails, so dbRateLimit yields
// null exactly as a real outage would.
vi.mock("./backend/env", () => ({ isDatabaseConfigured: () => true }));
vi.mock("./backend/server", () => ({
  createServiceClient: () => {
    throw new Error("db unavailable");
  },
}));

describe("rateLimit local fallback", () => {
  beforeEach(() => __clearBucketsForTests());

  it("allows up to limit then blocks", () => {
    for (let i = 0; i < 3; i++) {
      const r = __localRateLimitForTests("test:ip", 3, 60_000);
      expect(r.ok).toBe(true);
    }
    const blocked = __localRateLimitForTests("test:ip", 3, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("different keys are independent", () => {
    expect(__localRateLimitForTests("a", 1, 60_000).ok).toBe(true);
    expect(__localRateLimitForTests("b", 1, 60_000).ok).toBe(true);
  });
});

describe("getClientIp", () => {
  it("prefers the platform-set x-real-ip over any client-suppliable header", () => {
    const req = new Request("http://x", {
      headers: { "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(getClientIp(req)).toBe("9.9.9.9");
  });

  it("uses the LAST x-forwarded-for hop, not the client-controlled first entry", () => {
    // The first entry is attacker-suppliable; rotating it used to reset every
    // IP rate-limit bucket, defeating the throttle on unauthenticated routes.
    // The last hop is the closest proxy's view of the peer.
    const req = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
    expect(getClientIp(req)).toBe("5.6.7.8");
  });

  it("handles a single-hop x-forwarded-for", () => {
    const req = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4" } });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("falls back to unknown when no ip header is present", () => {
    expect(getClientIp(new Request("http://x"))).toBe("unknown");
  });
});

describe("clientIpFromHeaders (auth server actions)", () => {
  it("applies the same extraction as getClientIp, so a rotated first hop cannot reset the auth bucket", () => {
    const spoofA = new Headers({ "x-forwarded-for": "6.6.6.1, 5.6.7.8" });
    const spoofB = new Headers({ "x-forwarded-for": "6.6.6.2, 5.6.7.8" });
    expect(clientIpFromHeaders(spoofA)).toBe("5.6.7.8");
    expect(clientIpFromHeaders(spoofB)).toBe("5.6.7.8");
  });

  it("prefers x-real-ip over x-forwarded-for", () => {
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.2.3.4" }))).toBe("9.9.9.9");
  });
});

describe("failClosed paid-route protection", () => {
  it("denies when the shared limiter is configured but unreachable and failClosed is set", async () => {
    const r = await checkRateLimitKey("failclosed:k", { name: "t", limit: 5, windowMs: 60_000, failClosed: true });
    expect(r.ok).toBe(false);
  });

  it("falls back to the local bucket without failClosed", async () => {
    const r = await checkRateLimitKey("failopen:k", { name: "t", limit: 5, windowMs: 60_000 });
    expect(r.ok).toBe(true);
  });
});
