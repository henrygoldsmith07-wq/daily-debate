import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";
import { SESSION_COOKIE } from "./lib/backend/session";

describe("routing proxy", () => {
  it.each(["/", "/login", "/api/daily-topic"])("allows public route %s", (path) => {
    const response = proxy(new NextRequest(`https://daily-debate.test${path}`));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects a protected page when the session cookie is absent", () => {
    const response = proxy(new NextRequest("https://daily-debate.test/history"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://daily-debate.test/login?reason=sign-in-required",
    );
  });

  it("allows a protected page when a session cookie is present", () => {
    const request = new NextRequest("https://daily-debate.test/history", {
      headers: { cookie: `${SESSION_COOKIE}=opaque-session-token` },
    });

    const response = proxy(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
