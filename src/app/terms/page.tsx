import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms",
  description: "Terms of use for Daily Debate.",
};

export default function TermsPage() {
  return (
    <div className="flex flex-1 flex-col bg-[var(--background)]">
      <main id="main" className="mx-auto w-full max-w-2xl px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Terms of use</h1>
        <p className="mt-2 text-sm text-ink3">Last updated 2026-10-06.</p>

        <section className="mt-8 space-y-3 text-sm leading-6">
          <h2 className="text-lg font-semibold">The service</h2>
          <p className="text-ink2">
            Daily Debate is a practice tool: you argue a motion, receive feedback computed from observable argument
            features, repair a weak link, and track progress. An AI provides the opponent, summaries, and (in PvP)
            verdicts.
          </p>
        </section>

        <section className="mt-8 space-y-3 text-sm leading-6">
          <h2 className="text-lg font-semibold">AI output is practice signal, not truth</h2>
          <p className="text-ink2">
            Model-generated content — opponent arguments, summaries, judge verdicts — can be wrong, biased, or
            unfaithful to what you wrote. The project publishes its validation status honestly (see the README and{" "}
            <code>/metrics</code>): no model currently clears the judge gates, so every score, verdict, and trend is{" "}
            <strong>unvalidated training signal</strong>. Do not rely on it as advice, evaluation, or fact. The
            deterministic parts of the app state what they measure; the model parts are labelled provisional.
          </p>
        </section>

        <section className="mt-8 space-y-3 text-sm leading-6">
          <h2 className="text-lg font-semibold">Your account</h2>
          <ul className="list-disc space-y-2 pl-5 text-ink2">
            <li>One account per person; keep your credentials to yourself.</li>
            <li>
              Write only content you have the right to share. No harassment, spam, impersonation, or illegal
              material — reports and moderation flags exist to remove it.
            </li>
            <li>
              Do not probe, rate-limit-abuse, scrape, or attempt to access other users&apos; data or the operational
              endpoints.
            </li>
          </ul>
        </section>

        <section className="mt-8 space-y-3 text-sm leading-6">
          <h2 className="text-lg font-semibold">Your content and IP</h2>
          <p className="text-ink2">
            You keep ownership of what you write. You grant the service the licence needed to store it and process it
            through the AI providers listed on the <a href="/privacy" className="underline underline-offset-4">privacy page</a>{" "}
            for the purpose of running the product. You can export or delete everything at any time.
          </p>
        </section>

        <section className="mt-8 space-y-3 text-sm leading-6">
          <h2 className="text-lg font-semibold">Availability and liability</h2>
          <p className="text-ink2">
            The service is provided as-is, without warranty. Features may change, and the free or paid AI capacity
            behind them may be capped (the product degrades to explicit unavailable states rather than inventing
            results). To the extent permitted by law, the operator is not liable for losses arising from reliance on
            unvalidated model output. Nothing here limits rights you have under UK consumer or data protection law.
          </p>
        </section>

        <section className="mt-8 space-y-3 text-sm leading-6">
          <h2 className="text-lg font-semibold">Governing law</h2>
          <p className="text-ink2">These terms are governed by the laws of England and Wales.</p>
        </section>
      </main>
    </div>
  );
}
