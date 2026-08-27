import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { updateSession } from "./middleware";

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  if (originalAnonKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
});

describe("updateSession without Supabase configuration", () => {
  function removeSupabaseConfig() {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  }

  it.each(["/", "/login", "/api/daily-topic"])("allows %s to reach its route", async (path) => {
    removeSupabaseConfig();

    const response = await updateSession(new NextRequest(`https://daily-debate.test${path}`));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects a protected page to the available login route", async () => {
    removeSupabaseConfig();

    const response = await updateSession(new NextRequest("https://daily-debate.test/history"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://daily-debate.test/login?reason=auth-unavailable",
    );
  });
});
