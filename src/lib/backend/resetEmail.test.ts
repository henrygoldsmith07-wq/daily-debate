import { describe, expect, it, vi } from "vitest";
import { createResetTokenSender } from "./resetEmail";

describe("createResetTokenSender", () => {
  it("stays disabled until all delivery configuration is present", () => {
    expect(createResetTokenSender({}, vi.fn() as unknown as typeof fetch)).toBeUndefined();
    expect(
      createResetTokenSender(
        {
          RESEND_API_KEY: "re_test",
          PASSWORD_RESET_FROM: "Daily Debate <accounts@example.com>",
          NODE_ENV: "production",
        },
        vi.fn() as unknown as typeof fetch,
      ),
    ).toBeUndefined();
  });

  it("sends a bounded reset email through Resend with the token only in the reset URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const sender = createResetTokenSender(
      {
        RESEND_API_KEY: "re_secret",
        PASSWORD_RESET_FROM: "Daily Debate <accounts@example.com>",
        APP_BASE_URL: "https://debate.example.com/app/ignored",
      },
      fetchMock as unknown as typeof fetch,
    );
    expect(sender).toBeDefined();

    await sender?.("user@example.com", "raw-reset-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({ Authorization: "Bearer re_secret" });
    const body = JSON.parse(String(init.body)) as { to: string[]; html: string; text: string };
    expect(body.to).toEqual(["user@example.com"]);
    expect(body.html).toContain("https://debate.example.com/login/reset-password?token=raw-reset-token");
    expect(body.text).toContain("raw-reset-token");
    expect(JSON.stringify(init.headers)).not.toContain("raw-reset-token");
  });

  it("throws a bounded provider error without embedding recipient or token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad", { status: 503 }));
    const sender = createResetTokenSender(
      {
        RESEND_API_KEY: "re_secret",
        PASSWORD_RESET_FROM: "Daily Debate <accounts@example.com>",
        APP_BASE_URL: "https://debate.example.com",
      },
      fetchMock as unknown as typeof fetch,
    );

    await expect(sender?.("user@example.com", "very-secret-token")).rejects.toThrow("HTTP 503");
    try {
      await sender?.("user@example.com", "very-secret-token");
    } catch (error) {
      const message = String(error);
      expect(message).not.toContain("user@example.com");
      expect(message).not.toContain("very-secret-token");
    }
  });
});
