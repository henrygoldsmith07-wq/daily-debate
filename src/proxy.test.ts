import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";
import { SECURE_SESSION_COOKIE, SESSION_COOKIE } from "./lib/backend/session";

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

  // Auth.js picks the cookie name by whether the deployment is HTTPS, so the
  // proxy has to accept either one.
  it.each([SESSION_COOKIE, SECURE_SESSION_COOKIE])(
    "allows a protected page when %s is present",
    (cookieName) => {
      const request = new NextRequest("https://daily-debate.test/history", {
        headers: { cookie: `${cookieName}=a-session-jwt` },
      });

      const response = proxy(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
    },
  );
});
