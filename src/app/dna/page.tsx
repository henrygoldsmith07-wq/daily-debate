import { createClient } from "@/lib/backend/server";
import AppShell from "@/components/AppShell";
import SignedOut from "@/components/SignedOut";
import ArgumentDnaView from "@/components/ArgumentDnaView";
import { buildArgumentDnaForUser } from "@/lib/argumentDnaServer";
import { buildCoachingGoal } from "@/lib/coachingGoal";
import { loadCoachingContext } from "@/lib/coachingContextServer";
import { skillUnderTest } from "@/lib/retestDisclosure";
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
  //
  // The skill under a pending deliberate retest is EXCLUDED here exactly as
  // it is on the dashboard and on Progress: this page names the learner's
  // focus, so naming the skill under silent test would cue the very behaviour
  // the retest is meant to measure (retestDisclosure.ts).
  let focus: string | null = null;
  try {
    const context = await loadCoachingContext(user.id);
    const goal = buildCoachingGoal(
      context.ledger?.points ?? [],
      null,
      context.drillOutcomes,
      skillUnderTest(context.pendingRetests),
    );
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

