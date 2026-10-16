import { describe, it, expect, afterEach } from "vitest";
import { e2eMockAiEnabled } from "./aiE2eMock";

describe("e2eMockAiEnabled", () => {
  const prevE2e = process.env.E2E_MOCK_AI;
  const prevVercel = process.env.VERCEL_ENV;
  afterEach(() => {
    if (prevE2e === undefined) delete process.env.E2E_MOCK_AI;
    else process.env.E2E_MOCK_AI = prevE2e;
    if (prevVercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = prevVercel;
  });

  it("is off by default", () => {
    delete process.env.E2E_MOCK_AI;
    delete process.env.VERCEL_ENV;
    expect(e2eMockAiEnabled()).toBe(false);
  });

  it("is on for local/CI E2E, including production builds", () => {
    // Playwright runs `next build && next start` (NODE_ENV=production) with
    // E2E_MOCK_AI=1 and no VERCEL_ENV — the suite depends on this staying on.
    process.env.E2E_MOCK_AI = "1";
    delete process.env.VERCEL_ENV;
    expect(e2eMockAiEnabled()).toBe(true);
  });

  it("refuses to arm on a real Vercel production deployment", () => {
    // Canned debates/judges validate against the real provider schema, so
    // nothing downstream could tell them apart from model output.
    process.env.E2E_MOCK_AI = "1";
    process.env.VERCEL_ENV = "production";
    expect(e2eMockAiEnabled()).toBe(false);
  });

  it("stays on for preview deployments", () => {
    process.env.E2E_MOCK_AI = "1";
    process.env.VERCEL_ENV = "preview";
    expect(e2eMockAiEnabled()).toBe(true);
  });
});
