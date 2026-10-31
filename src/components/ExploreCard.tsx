import Link from "next/link";
import type { ExploreItem, ExploreSide } from "@/lib/explore";
import ExploreVote from "./ExploreVote";

function SideColumn({ side, label }: { side: ExploreSide; label: "For" | "Against" }) {
  return (
    <div className={`explore-side explore-side-${label.toLowerCase()}`}>
      <p className="explore-side-head">
        <span className="explore-side-chip">{label}</span>
        <span className="explore-side-name">{side.name}</span>
      </p>
      <p className="explore-side-excerpt">{side.excerpt ?? "No opening argument recorded."}</p>
    </div>
  );
}

/**
 * One published debate in the Explore feed (the Geo card): the motion as the
 * title, the two sides face to face, then the vote. The whole card opens the
 * debate at full length.
 */
export default function ExploreCard({ item, signedIn }: { item: ExploreItem; signedIn: boolean }) {
  const href = `/explore/${item.kind}/${item.id}`;
  return (
    <article className="explore-card surface-card" data-testid="explore-card" aria-labelledby={`explore-${item.id}`}>
      <header className="explore-card-head">
        <span className="explore-card-kind">{item.kind === "pvp" ? "Player vs player" : "Versus the AI"}</span>
        <Link href={href} className="explore-card-expand" aria-label={`Open "${item.topicTitle}" at full length`}>
          ↗
        </Link>
      </header>
      <h2 id={`explore-${item.id}`} className="explore-card-title">
        <Link href={href}>{item.topicTitle}</Link>
      </h2>
      <div className="explore-sides">
        <SideColumn side={item.for} label="For" />
        <span className="explore-vs" aria-hidden="true">vs</span>
        <SideColumn side={item.against} label="Against" />
      </div>
      <ExploreVote
        kind={item.kind}
        id={item.id}
        forName={item.for.name}
        againstName={item.against.name}
        initialVotes={item.votes}
        initialMyVote={item.myVote}
        isParticipant={item.isParticipant}
        signedIn={signedIn}
      />
    </article>
  );
}
