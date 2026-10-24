import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

import TopicCard from "./TopicCard";
import { firstFocusView } from "@/lib/guestFocus";
import { GOAL_HEADLINES } from "@/lib/coachingGoal";
import type { DailyTopic } from "@/lib/types";

const topic = { id: "topic-1", title: "Motion", prompt: "Prompt", category: "Policy", sources: [] } as unknown as DailyTopic;

describe("TopicCard guest-seeded first focus", () => {
  it("pre-selects the guest skill with an unvalidated label and a way to change it", () => {
    const html = renderToStaticMarkup(
      <TopicCard topic={topic} activeDebateId={null} isFirstVisit firstFocus={firstFocusView("evidence")} />,
    );
    expect(html).toContain('data-testid="first-focus"');
    expect(html).toContain("From your guest practice — unvalidated");
    expect(html).toContain(GOAL_HEADLINES.evidence);
    expect(html).toContain("not scored");
    expect(html).toContain('data-testid="first-focus-select"');
    expect(html).toContain("No focus for this debate");
    // The guest seed replaces the generic how-it-works line, not the other way round.
    expect(html).not.toContain("How it works");
  });

  it("keeps the ordinary first-visit card when there is no guest seed", () => {
    const html = renderToStaticMarkup(<TopicCard topic={topic} activeDebateId={null} isFirstVisit />);
    expect(html).toContain("How it works");
    expect(html).not.toContain("first-focus");
  });
});
