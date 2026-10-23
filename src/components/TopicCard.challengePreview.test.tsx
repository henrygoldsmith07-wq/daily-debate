import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

import TopicCard from "./TopicCard";
import type { DailyTopic } from "@/lib/types";

// "Challenge me" is the default side. Before this change the start screen
// only promised to "show it when you start", so a learner committed to a
// debate without knowing which side they'd argue. The card now reveals the
// server-resolved side and its reason before the start button.

const topic = {
  id: "topic-1",
  title: "Cities should ban cars from their centres",
  prompt: "Should they?",
  category: "Policy",
  sources: [],
} as unknown as DailyTopic;

function render(props: Partial<Parameters<typeof TopicCard>[0]> = {}) {
  return renderToStaticMarkup(<TopicCard topic={topic} activeDebateId={null} {...props} />);
}

describe("TopicCard Challenge me reveal", () => {
  it("shows which side the learner will argue, and why, before the debate starts", () => {
    const html = render({
      challengePreview: {
        side: "against",
        rule: "side-balance",
        reason: "You've argued FOR in 4 of your last 4 debates — switching to AGAINST for variety and steelmanning practice.",
      },
    });
    expect(html).toContain('data-testid="challenge-side-preview"');
    expect(html).toContain("You&#x27;ll argue AGAINST");
    expect(html).toContain("switching to AGAINST for variety");
    expect(html).toContain('data-challenge-side="against"');
    expect(html).not.toContain("show it when you start");
  });

  it("keeps a random pick labelled as random", () => {
    const html = render({
      challengePreview: {
        side: "for",
        rule: "random-cold-start",
        reason: "No history yet — picked FOR at random for a balanced first workout.",
      },
    });
    expect(html).toContain("You&#x27;ll argue FOR");
    expect(html).toContain("at random");
  });

  it("falls back to the deferred-reveal note when the side could not be resolved", () => {
    const html = render({ challengePreview: null });
    expect(html).toContain('data-testid="challenge-side-note"');
    expect(html).toContain("show it when you start");
    expect(html).not.toContain("challenge-side-preview");
  });

  it("shows no reveal once a debate is already active", () => {
    const html = render({
      activeDebateId: "debate-1",
      challengePreview: { side: "for", rule: "alternation-fallback", reason: "Last time you argued AGAINST." },
    });
    expect(html).not.toContain("challenge-side-note");
    expect(html).toContain("Continue your debate");
  });
});
