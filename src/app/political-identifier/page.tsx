import AppShell from "@/components/AppShell";
import SignedOut from "@/components/SignedOut";
import PageHeader from "@/components/PageHeader";
import PoliticalIdentifierView from "@/components/PoliticalIdentifierView";
import { getCurrentUser } from "@/lib/currentViewer";
import { loadPoliticalIdentifier } from "@/lib/politicalIdentifierServer";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Political identifier · Daily Debate",
  description: "Where you've stood on daily motions, as a pattern of choices — not a measure of belief.",
};

/** A failed read is an honest absence, never a fabricated zero-data result. */
function Unavailable() {
  return (
    <AppShell width="narrow">
      <PageHeader
        eyebrow="Your stance"
        title="Political identifier"
        description="Where you've stood across daily motions."
      />
      <div className="surface-card p-5" role="alert">
        <p className="text-sm font-semibold text-[var(--bad)]">Political identifier could not be loaded</p>
        <p className="mt-1 text-sm text-ink3">
          Your positions are safe — this is a temporary read problem. Reload to try again.
        </p>
      </div>
    </AppShell>
  );
}

export default async function PoliticalIdentifierPage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <AppShell width="narrow">
        <SignedOut
          title="Sign in to see your political identifier"
          description="Take positions on daily motions to see where you've stood over time."
        />
      </AppShell>
    );
  }

  let model: Awaited<ReturnType<typeof loadPoliticalIdentifier>> = null;
  try {
    model = await loadPoliticalIdentifier(user.id);
  } catch {
    return <Unavailable />;
  }
  if (!model) return <Unavailable />;

  return (
    <AppShell width="default">
      <PoliticalIdentifierView model={model} />
    </AppShell>
  );
}
