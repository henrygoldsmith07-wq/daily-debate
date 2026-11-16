import type { Metadata } from "next";
import Link from "next/link";
import { getTodayTopic } from "@/lib/dailyTopic";
import { isDatabaseConfigured } from "@/lib/backend/env";
import { MARK_LEGEND, parseShareQuery, shareQuery, squareFor, squares } from "@/lib/shareCard";

// Landing page for a shared result. Everything shown about the sharer comes
// from validated codes (day number, side, squares, repair) — never free text
// from the URL. The motion shown is TODAY's, read server-side, because the
// point of the page is "your turn".

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const card = parseShareQuery(await searchParams);
  const title = card?.dayNumber ? `Daily Debate #${card.dayNumber}` : "Daily Debate";
  const description = card
    ? `${squares(card.marks)} Argued ${card.side === "for" ? "For" : "Against"}. Your turn: today's motion takes about four minutes.`
    : "One motion a day, one weakness to fix. About four minutes.";
  const image = card ? `/api/share-image?${shareQuery(card)}` : "/api/share-image";
  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function SharedResultPage({ searchParams }: { searchParams: SearchParams }) {
  const card = parseShareQuery(await searchParams);
  const topic = isDatabaseConfigured() ? await getTodayTopic().catch(() => null) : null;

  return (
    <main id="main" className="app-content mx-auto max-w-xl px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink3">Shared result</p>
      <h1 className="page-title mt-2">{card?.dayNumber ? `Daily Debate #${card.dayNumber}` : "Daily Debate"}</h1>
      {card ? (
        <section className="surface-card mt-5 p-5" aria-label="Their result">
          <p className="text-sm text-ink2">Argued {card.side === "for" ? "For" : "Against"}</p>
          {card.marks.length ? (
            <p className="mt-3 text-3xl tracking-[0.2em]" aria-label="One square per round">
              {squares(card.marks)}
            </p>
          ) : null}
          <p className="mt-3 text-sm font-semibold">{card.repaired ? "Weakness repaired ✓" : "Repair still to do"}</p>
          <ul className="mt-4 space-y-1 text-xs text-ink3">
            {MARK_LEGEND.map((item) => (
              <li key={item.mark}>
                <span aria-hidden="true">{squareFor(item.mark)}</span> {item.label}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink3">
            Squares are observed moves from a text check, not a score or a judgement of who won.
          </p>
        </section>
      ) : null}

      <section className="surface-card mt-5 p-5" aria-labelledby="your-turn">
        <h2 id="your-turn" className="text-lg font-semibold">Your turn</h2>
        {topic ? <p className="mt-2 text-base font-semibold">{topic.title}</p> : null}
        <p className="mt-2 text-sm text-ink2">
          Three rounds against an AI opponent, about four minutes. No account needed to try it.
        </p>
        <Link href="/" className="btn btn-primary mt-4 inline-block px-4 py-3 text-sm">
          Debate today&apos;s motion <span aria-hidden="true">→</span>
        </Link>
      </section>
    </main>
  );
}
