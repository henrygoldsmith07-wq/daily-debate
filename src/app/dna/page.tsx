import { createClient } from "@/lib/backend/server";
import AppHeader from "@/components/AppHeader";
import ArgumentDnaView from "@/components/ArgumentDnaView";
import { buildArgumentDnaForUser } from "@/lib/argumentDnaServer";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Argument DNA",
  description: "See how your argument habits and reasoning graph change across every Daily Debate.",
};

export default async function ArgumentDnaPage() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col">
        <AppHeader />
        <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-10 sm:px-6">
          <p className="text-xs uppercase tracking-wide text-ink3">Argument DNA</p>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to see how your reasoning changes.</h1>
          <p className="max-w-lg text-sm leading-relaxed text-ink3">
            Finish a few Daily Debates and this page will turn their argument graphs into a persistent profile — patterns you can act on, not just a score.
          </p>
        </main>
      </div>
    );
  }

  const model = await buildArgumentDnaForUser(user.id);
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main id="main" className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-10">
        <ArgumentDnaView model={model} />
      </main>
    </div>
  );
}

