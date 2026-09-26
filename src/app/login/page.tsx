import Link from "next/link";
import AuthForm from "./AuthForm";
import { isDatabaseConfigured } from "@/lib/backend/env";
import { safeReturnPath } from "@/lib/authRedirect";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const nextPath = safeReturnPath(Array.isArray(params.next) ? params.next[0] : params.next);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 bg-[var(--background)] px-6 py-16">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Daily Debate</h1>
        <p className="max-w-xs text-sm text-ink3">
          Argue with an AI, get feedback on observable reasoning moves, repair one weak link, then test it again later.
        </p>
      </div>
      {isDatabaseConfigured() ? (
        <AuthForm nextPath={nextPath} />
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
