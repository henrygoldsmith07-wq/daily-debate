import type { Metadata } from "next";
import { createClient } from "@/lib/backend/server";
import AccountDataControls from "@/components/AccountDataControls";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Daily Debate stores, who processes it, and how to export or delete your data (UK GDPR).",
};

export const dynamic = "force-dynamic";

const PROCESSORS = [
  {
    name: "Neon (Postgres, AWS eu-west-2 London)",
    what: "Primary database. Stores your account, debates, progress, and bounded operational telemetry.",
  },
  {
    name: "Vercel (application hosting)",
    what: "Serves the app at the edge and runs the server routes. Standard request logs only.",
  },
  {
    name: "Anthropic (AI model provider)",
    what:
      "Generates your AI opponent, the finish summary, and PvP verdicts. Debate transcripts and the motion are sent to the model (default `claude-sonnet-5`). This is the only third party that receives debate content in production.",
  },
  {
    name: "Free-model transports (OpenRouter, NVIDIA, UnoRouter, Kirai)",
    what:
      "Alternative AI transports used only when explicitly enabled outside production (dev/e2e). Never used in production by default.",
  },
  {
    name: "classifier.dev (argument-structure classification)",
    what:
      "Disabled by default. If the operator enables `CLASSIFIER_DEV_ENABLED=1`, argument texts (truncated to 4,000 characters) plus the motion title and prompt are sent for rhetorical-role classification. No ids, winners, scores, or political judgements are sent.",
  },
  {
    name: "Resend (transactional email)",
    what: "Sends password-reset emails only. No marketing email exists.",
  },
];

export default async function PrivacyPage() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  return (
    <div className="flex flex-1 flex-col bg-[var(--background)]">
      <main id="main" className="mx-auto w-full max-w-2xl px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Privacy</h1>
        <p className="mt-2 text-sm text-ink3">
          Last updated 2026-10-06. This is a UK-GDPR-oriented notice for a small self-hosted service operated from
          the UK. It states what is actually stored and who processes it — nothing more.
        </p>

        <section className="mt-8 space-y-3 text-sm leading-6">
          <h2 className="text-lg font-semibold">What we store</h2>
          <ul className="list-disc space-y-2 pl-5 text-ink2">
            <li>
              <strong>Account:</strong> your email address and a salted password hash. Nothing else identifies you.
            </li>
            <li>
              <strong>Debate content:</strong> the messages you write, the AI replies, scores computed from observable
              features, coaching notes, and PvP match state. Needed to run the loop you asked for.
            </li>
            <li>
              <strong>Progress:</strong> skill points, streaks, repairs, drills, and allowlisted funnel events (no free
              text, no device or cross-site identifiers).
            </li>
            <li>
              <strong>Operational telemetry:</strong> <code>ai_call_log</code> records operation, model, token counts,
              latency, outcome, and provider-reported cost — never prompt or response content, never raw provider
              error text.
            </li>
            <li>
              <strong>Guest practice</strong> stays on your device. Nothing is stored server-side until you create an
              account.
            </li>
          </ul>
        </section>

        <section className="mt-8 space-y-3 text-sm leading-6">
          <h2 className="text-lg font-semibold">Who processes it</h2>
          <ul className="list-disc space-y-2 pl-5 text-ink2">
            {PROCESSORS.map((processor) => (
              <li key={processor.name}>
                <strong>{processor.name}</strong> — {processor.what}
              </li>
            ))}
          </ul>
          <p className="text-ink3">
            There are no advertising networks, session-replay tools, or cross-site analytics. Product analytics live
            in our own database. Sending debate content to an AI provider is how the product works; it is the only
            place content leaves the service, and only Anthropic receives it in production.
          </p>
        </section>

        <section className="mt-8 space-y-3 text-sm leading-6">
          <h2 className="text-lg font-semibold">Why, and your rights</h2>
          <p className="text-ink2">
            Legal basis: performance of the contract (running debates and progress you request) and legitimate
            interests (abuse prevention via rate limits). Under UK GDPR you can request a copy of your data, correct
            it, erase it, restrict or object to processing, and complain to the ICO. Erasure and export are
            self-service below; other requests can be made to the contact address published in the project&apos;s
            GitHub repository About section.
          </p>
        </section>

        <section className="mt-8 space-y-3 text-sm leading-6">
          <h2 className="text-lg font-semibold">Your data</h2>
          <p className="text-ink2">
            Export produces a JSON file of everything above. Deletion is immediate and irreversible: it removes your
            account, debates, events, progress, your PvP matches <em>(including shared matches — the other
            player&apos;s copy of a two-party record cannot outlive your account)</em>, invites that name you, and
            your corpus contributions together with any ratings left on them. Operational telemetry with no personal
            identifiers (model/cost/latency logs, aggregate funnel counts) is kept because it cannot be linked back
            to you.
          </p>
          <AccountDataControls signedIn={!!user} email={user?.email ?? null} />
        </section>

        <p className="mt-10 text-xs text-ink3">
          Questions about this notice: use the contact address in the project&apos;s GitHub About section.
        </p>
      </main>
    </div>
  );
}
