import { getOrCreateTodayTopic } from "@/lib/dailyTopic";
import AppHeader from "@/components/AppHeader";
import PvpLobby from "@/components/PvpLobby";

// Generates today's topic via the Gemini API on first request each day —
// not something that can be prerendered at build time.
export const dynamic = "force-dynamic";

export default async function PvpLobbyPage() {
  let topic: Awaited<ReturnType<typeof getOrCreateTodayTopic>> | null = null;
  try {
    topic = await getOrCreateTodayTopic();
  } catch (error) {
    console.error("Failed to load daily topic:", error);
  }

  if (!topic) {
    return (
      <div className="flex min-h-screen flex-col">
        <AppHeader />
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-6 py-10 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Today&apos;s topic isn&apos;t ready</h1>
          <p className="text-sm text-ink3">
            PvP needs today&apos;s debate topic, but it couldn&apos;t be loaded. Please refresh in a moment.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
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
