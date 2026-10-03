import { createClient } from "@/lib/backend/server";
import AppShell from "@/components/AppShell";
import SignedOut from "@/components/SignedOut";
import ArgumentDnaView from "@/components/ArgumentDnaView";
import { buildArgumentDnaForUser } from "@/lib/argumentDnaServer";
import { buildLedgerForUser } from "@/lib/skillLedgerServer";
import { buildCoachingGoal } from "@/lib/coachingGoal";
import { DIMENSION_LABELS } from "@/lib/adaptiveCoach";

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
      <AppShell width="narrow">
        <SignedOut
          title="Sign in to see how your reasoning changes"
          description="Finish a few Daily Debates and this page turns their argument graphs into a persistent profile — patterns you can act on, not just a score."
        />
      </AppShell>
    );
  }

  const model = await buildArgumentDnaForUser(user.id);
  // The current deliberate-practice focus, from the shared coaching loop —
  // one source of truth for "what am I training", never a second selector.
  let focus: string | null = null;
  try {
    const ledger = await buildLedgerForUser(user.id);
    const goal = buildCoachingGoal(ledger.points, null);
    focus = goal?.dimension ? (DIMENSION_LABELS[goal.dimension] ?? goal.dimension) : null;
  } catch {
    focus = null;
  }
  return (
    <AppShell width="wide">
      <ArgumentDnaView model={model} focus={focus} />
    </AppShell>
  );
}

