import "server-only";

import type { ResetTokenSender } from "./auth";

type ResetEmailEnv = Partial<
  Pick<
    NodeJS.ProcessEnv,
    "RESEND_API_KEY" | "PASSWORD_RESET_FROM" | "APP_BASE_URL" | "VERCEL_PROJECT_PRODUCTION_URL" | "VERCEL_URL" | "NODE_ENV"
  >
>;

function baseUrlFromEnv(env: ResetEmailEnv): string | null {
  const explicit = env.APP_BASE_URL?.trim();
  if (explicit) {
    try {
      const url = new URL(explicit);
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      return url.origin;
    } catch {
      return null;
    }
  }

  const vercelHost = env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || env.VERCEL_URL?.trim();
  if (vercelHost) return `https://${vercelHost.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  if (env.NODE_ENV !== "production") return "http://localhost:3000";
  return null;
}

/**
 * Build the production password-reset sender without adding a mail SDK to the
 * runtime bundle. Resend's HTTPS API is enough for this single transactional
 * message and keeps the dependency/security surface small.
 */
export function createResetTokenSender(
  env: ResetEmailEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): ResetTokenSender | undefined {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.PASSWORD_RESET_FROM?.trim();
  const baseUrl = baseUrlFromEnv(env);
  if (!apiKey || !from || !baseUrl) return undefined;

  return async (email, token) => {
    const resetUrl = new URL("/login/reset-password", baseUrl);
    resetUrl.searchParams.set("token", token);

    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "Reset your Daily Debate password",
        html: `<p>Use the link below to reset your Daily Debate password.</p><p><a href="${resetUrl.toString()}">Reset password</a></p><p>This link expires in 30 minutes. If you did not request it, you can ignore this email.</p>`,
        text: `Reset your Daily Debate password: ${resetUrl.toString()}\n\nThis link expires in 30 minutes. If you did not request it, you can ignore this email.`,
      }),
    });

    if (!response.ok) {
      throw new Error(`Password reset email provider returned HTTP ${response.status}.`);
    }
  };
}
