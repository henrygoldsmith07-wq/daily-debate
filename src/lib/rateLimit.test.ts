import { describe, it, expect, beforeEach } from "vitest";
import { __localRateLimitForTests, __clearBucketsForTests, getClientIp } from "./rateLimit";

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
  it("prefers x-forwarded-for first entry", () => {
    const req = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });
  it("falls back to x-real-ip then unknown", () => {
    const r1 = new Request("http://x", { headers: { "x-real-ip": "9.9.9.9" } });
    expect(getClientIp(r1)).toBe("9.9.9.9");
    const r2 = new Request("http://x");
    expect(getClientIp(r2)).toBe("unknown");
  });
});
