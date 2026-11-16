import Link from "next/link";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import ExploreCard from "@/components/ExploreCard";
import { getCurrentUser } from "@/lib/currentViewer";
import { listExplore } from "@/lib/explore";

export const dynamic = "force-dynamic";

export default async function ExplorePage() {
  const user = await getCurrentUser();
  let items: Awaited<ReturnType<typeof listExplore>> = [];
  let failed = false;
  try {
    items = await listExplore(user?.id ?? null);
  } catch (error) {
    console.error("explore list failed:", error);
    failed = true;
  }

  return (
    <AppShell width="narrow">
      <PageHeader
        eyebrow="Explore"
        title="Debates people published"
        description="Finished debates their debaters chose to share. Read both sides, then vote on who argued better."
      />
      {failed ? (
        <p className="surface-card p-5 text-sm text-ink2" role="alert">Explore could not load right now. Try again in a moment.</p>
      ) : items.length === 0 ? (
        <section className="surface-card p-6 text-sm text-ink2" data-testid="explore-empty">
          <p className="font-semibold text-ink">Nothing published yet.</p>
          <p className="mt-1">
            Finish a debate and choose &ldquo;Publish to Explore&rdquo; on its result, or play someone in{" "}
            <Link href="/pvp" className="underline">Player vs Player</Link> and both agree to share it.
          </p>
        </section>
      ) : (
        <div className="explore-feed" data-testid="explore-feed">
          {items.map((item) => (
            <ExploreCard key={`${item.kind}-${item.id}`} item={item} signedIn={Boolean(user)} />
          ))}
        </div>
      )}
    </AppShell>
  );
}
