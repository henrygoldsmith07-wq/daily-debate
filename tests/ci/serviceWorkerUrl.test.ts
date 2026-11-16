import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sw = readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8");

describe("service worker push URL", () => {
  it("rejects protocol-relative URLs, not just absolute ones", () => {
    // `startsWith("/")` alone accepts "//evil.com", which client.navigate()
    // and openWindow() would treat as an external origin.
    expect(sw).toMatch(/data\.url\.startsWith\("\/"\) && !data\.url\.startsWith\("\/\/"\)/);
  });
});
