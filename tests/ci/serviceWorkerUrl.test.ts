import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sw = readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8");

describe("service worker push URL", () => {
  it("validates push URLs by origin, not by string prefixes", () => {
    // Both "//evil.com" and "/\evil.com" start with "/" but resolve off-origin
    // (the URL parser normalises backslash to slash for https:). String checks
    // were bypassable; the guard must compare parsed origins.
    expect(sw).toContain("function safePushUrl(raw)");
    expect(sw).toContain("resolved.origin !== self.location.origin");
    expect(sw).toContain("const url = safePushUrl(data.url);");
    expect(sw).toContain("safePushUrl(event.notification.data?.url)");
    expect(sw).not.toMatch(/data\.url\.startsWith\("\/"\)/);
  });

  it("confirms the off-origin premise the guard defends against", () => {
    const origin = "https://daily-debate.example";
    expect(new URL("//evil.com", origin).origin).toBe("https://evil.com");
    expect(new URL("/\\evil.com", origin).origin).toBe("https://evil.com");
    const safe = new URL("/?src=push", origin);
    expect(safe.origin).toBe(origin);
    expect(safe.pathname + safe.search + safe.hash).toBe("/?src=push");
  });
});
