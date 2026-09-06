import Link from "next/link";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import { EVIDENCE_CLASS_LABELS } from "@/lib/argGraph";

export const metadata = {
  title: "Trust & research",
  description:
    "How Daily Debate validates its judges: the human-rated corpus, published metrics, and how to rate debates yourself.",
};

const DESTINATIONS = [
  {
    href: "/benchmark",
    label: "Judge benchmark",
    description:
      "Live validation runs against a stratified fixture pack — agreement with expected winners, position-swap stability, and probe resistance.",
  },
  {
    href: "/metrics",
    label: "Corpus metrics",
    description:
      "Published evaluation numbers over the human-rated corpus. Every metric carries an evidence state; dashes mean not enough data yet.",
  },
  {
    href: "/rate",
    label: "Rate debates",
    description:
      "Blind-rate finished debates to grow the human corpus. Human consensus is the yardstick every judge is measured against.",
  },
];

const EVIDENCE_CLASSES = Object.entries(EVIDENCE_CLASS_LABELS) as Array<
  [keyof typeof EVIDENCE_CLASS_LABELS, { short: string; description: string }]
>;

export default function ResearchPage() {
  return (
    <AppShell width="narrow">
      <PageHeader
        eyebrow="Trust & research"
        title="How the judging works — and how it is checked"
        description="Scores come from AI judges, so the trust surface is the judges themselves. This page explains the evidence classes used across the app and links the validation work."
      />

      <section className="surface-card p-5 flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Evidence classes</h2>
        <p className="text-xs text-ink3">
          Every piece of evidence in an argument graph is tagged with one of four classes. The class signals how much
          weight a claim can bear — hover any tag in a debate to see the definition in place.
        </p>
        <ul className="flex flex-col gap-3">
          {EVIDENCE_CLASSES.map(([key, label]) => (
            <li key={key} className="rounded-xl border border-[var(--rule)] bg-[var(--surface-2)] p-3">
              <p className="text-sm font-medium">
                <span className="tabular text-ink3">[{label.short}]</span> {key}
              </p>
              <p className="mt-1 text-xs text-ink3">{label.description}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="surface-card p-5 flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Validation &amp; metrics</h2>
        <ul className="flex flex-col gap-3">
          {DESTINATIONS.map((d) => (
            <li key={d.href} className="rounded-xl border border-[var(--rule)] p-4 transition-colors hover:bg-[var(--surface-2)]">
              <Link href={d.href} className="flex flex-col gap-1">
                <span className="text-sm font-medium underline-offset-2 hover:underline">{d.label} →</span>
                <span className="text-xs text-ink3">{d.description}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink3">
          Uncertainty note: per-debate confidence numbers are provisional heuristics over judge agreement — the
          calibrated quantities live in the corpus metrics above, and only appear once enough human ratings exist.
        </p>
      </section>
    </AppShell>
  );
}
