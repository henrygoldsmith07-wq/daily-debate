import { getTodayTopic } from "@/lib/dailyTopic";
import AppHeader from "@/components/AppHeader";
import PvpLobby from "@/components/PvpLobby";

// Generates today's topic via the OpenRouter API on first request each day —
// not something that can be prerendered at build time.
export const dynamic = "force-dynamic";

export default async function PvpLobbyPage() {
  // getTodayTopic never throws — always serves from store or curated fallback.
  const topic = await getTodayTopic();

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink3">Player vs Player</p>
          <h1 className="text-2xl font-semibold tracking-tight">{topic.title}</h1>
          <p className="mt-2 text-sm text-ink3">{topic.prompt}</p>
        </div>
        <PvpLobby />
      </main>
    </div>
  );
}
