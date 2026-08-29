import { getTodayTopic } from "@/lib/dailyTopic";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import PvpLobby from "@/components/PvpLobby";

// Generates today's topic via the OpenRouter API on first request each day —
// not something that can be prerendered at build time.
export const dynamic = "force-dynamic";

export default async function PvpLobbyPage() {
  // getTodayTopic never throws — always serves from store or curated fallback.
  const topic = await getTodayTopic();

  return (
    <AppShell width="narrow">
      <PageHeader
        eyebrow="Player vs Player"
        title={topic.title}
        description={topic.prompt}
        actions={<span className="pill">{topic.category ?? "Today's motion"}</span>}
      />
      <PvpLobby />
    </AppShell>
  );
}
