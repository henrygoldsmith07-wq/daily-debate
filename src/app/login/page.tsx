import Link from "next/link";
import AuthForm from "./AuthForm";
import { isDatabaseConfigured } from "@/lib/backend/env";
import { googleEnabled } from "@/lib/backend/auth-config";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 bg-[var(--background)] px-6 py-16">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Daily Debate</h1>
        <p className="max-w-xs text-sm text-ink3">
          Argue with an AI, get scored on how sharp your thinking is, then take on other players.
        </p>
      </div>
      {isDatabaseConfigured() ? (
        <AuthForm googleEnabled={googleEnabled} />
      ) : (
        <div className="surface-card max-w-sm space-y-4 p-6 text-center">
          <div>
            <h2 className="font-semibold">Sign-in is temporarily unavailable</h2>
            <p className="mt-2 text-sm text-ink3">
              Daily Debate is still available in guest mode while account services are restored.
            </p>
          </div>
          <Link href="/" className="btn btn-primary inline-flex px-4 py-2 text-sm">
            Try a guest debate
          </Link>
        </div>
      )}
    </div>
  );
}
