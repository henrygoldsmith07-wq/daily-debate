import Link from "next/link";
import PageHeader from "./PageHeader";
import type { PoliticalIdentifierModel } from "@/lib/politicalIdentifier";

/** A short run of tally marks; the count beside them is the accessible value. */
function Marks({ n, tone }: { n: number; tone: "for" | "against" }) {
  const shown = Math.min(n, 5);
  return (
    <span className="pid-marks" aria-hidden="true">
      {Array.from({ length: shown }, (_, i) => (
        <span key={i} className={`pid-mark pid-mark-${tone}`} />
      ))}
    </span>
  );
}

export default function PoliticalIdentifierView({ model }: { model: PoliticalIdentifierModel }) {
  const insufficient = model.state !== "ok" || model.total === 0;

  return (
    <div className="pid-page" data-testid="political-identifier">
      <PageHeader
        eyebrow="Your stance"
        title="Political identifier"
        description="Where you've stood across daily motions. A pattern of choices, not a measure of your beliefs."
      />

      {insufficient ? (
        <section className="surface-card pid-empty" aria-labelledby="pid-empty-heading">
          <p className="pid-empty-count">
            {model.total}<span>/{model.needed}</span>
          </p>
          <h2 id="pid-empty-heading" className="pid-empty-title">Positions taken</h2>
          <p className="pid-empty-copy">
            Take a stand on a few more motions. After {model.needed} positions, this page reads the
            pattern in where you chose to argue — nothing about what you believe.
          </p>
          <Link href="/" className="btn btn-primary px-4 py-2 text-sm">Argue today&apos;s motion</Link>
        </section>
      ) : (
        <>
          <section className="pid-verdict" aria-labelledby="pid-verdict-heading">
            <p id="pid-verdict-heading" className="pid-verdict-label">Your record</p>
            <h2 className="pid-verdict-line">{model.verdict}</h2>
            <p className="pid-verdict-meta">
              {model.total} position{model.total === 1 ? "" : "s"} · across {model.categories.length}{" "}
              topic{model.categories.length === 1 ? "" : "s"}
            </p>
          </section>

          <section className="pid-ledger" aria-labelledby="pid-ledger-heading">
            <h2 id="pid-ledger-heading" className="pid-section-title">The division ledger</h2>
            <div className="pid-ledger-head" aria-hidden="true">
              <span>Topic</span>
              <span>For</span>
              <span>Against</span>
            </div>
            <ul className="pid-ledger-list">
              {model.categories.map((category) => (
                <li key={category.key} className="pid-row">
                  <span className="pid-row-label">{category.label}</span>
                  <span className="pid-row-side">
                    <Marks n={category.forCount} tone="for" />
                    <span className="pid-count">{category.forCount}</span>
                  </span>
                  <span className="pid-row-side">
                    <Marks n={category.againstCount} tone="against" />
                    <span className="pid-count">{category.againstCount}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <aside className="pid-note" aria-labelledby="pid-note-heading">
            <h2 id="pid-note-heading" className="pid-note-title">How to read this</h2>
            <p>{model.note}</p>
            <p className="pid-note-secondary">
              You may have taken a side because the exercise called for it. This is a record of those
              choices, not a diagnosis.
            </p>
          </aside>
        </>
      )}
    </div>
  );
}
