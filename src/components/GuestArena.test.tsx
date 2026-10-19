import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import GuestArena from "./GuestArena";
import { encodeGuestArenaProgress, GUEST_ARENA_STORAGE_KEY } from "@/lib/guestLoop";

// First-visit snags a new user hits on the guest page. Rendered statically
// (node env): with no `window`, the arena restores to the guest home; a
// stubbed sessionStorage restores a later stage the way a reload would.

const FLAG = "NEXT_PUBLIC_EXPERIMENTAL_SURFACES";

function renderAtStage(progress: Parameters<typeof encodeGuestArenaProgress>[0] | null): string {
  if (progress) {
    vi.stubGlobal("window", {
      location: { href: "http://localhost/" },
      sessionStorage: {
        getItem: (key: string) => (key === GUEST_ARENA_STORAGE_KEY ? encodeGuestArenaProgress(progress) : null),
        setItem: () => {},
        removeItem: () => {},
      },
    });
  }
  return renderToStaticMarkup(<GuestArena />);
}

describe("GuestArena first visit", () => {
  const previous = process.env[FLAG];
  afterEach(() => {
    vi.unstubAllGlobals();
    if (previous === undefined) delete process.env[FLAG];
    else process.env[FLAG] = previous;
  });

  it("does not advertise parked PvP on the guest home when the flag is off", () => {
    delete process.env[FLAG];
    const html = renderAtStage(null);
    expect(html).toContain("With an account");
    expect(html).not.toContain("Player vs Player");
    expect(html).not.toContain("Debate other people");
  });

  it("does not overclaim what guest practice checks or what an account measures", () => {
    delete process.env[FLAG];
    const html = renderAtStage(null).toLowerCase();
    expect(html).not.toContain("each round is scored on the same seven");
    expect(html).not.toContain("real skill measurement");
    expect(html).not.toContain("every rep");
    expect(html).not.toContain("argument graph");
    expect(html).not.toContain("observable strength");
  });

  it("labels the auto-assign side option as the app choosing", () => {
    const html = renderAtStage(null);
    expect(html).toContain("Pick for me");
    expect(html).not.toContain("Pick my side");
  });

  it("does not let an unanswered retest be finished as 'not observed'", () => {
    const today = new Date().toISOString().slice(0, 10);
    const html = renderAtStage({
      version: 1,
      motionDate: today,
      stage: "retest",
      side: "for",
      responses: ["one", "two", "three"],
      repair: { kind: "evidence", label: "Evidence", text: "According to a named study, this holds.", succeeded: true },
      retestDemonstrated: null,
    });
    expect(html).toContain("Now argue it again");
    expect(html).not.toContain("Finish guest practice");
    expect(html).toContain("Back to my result");
    // Sign-up CTAs open the Create account tab.
    expect(html).toContain('href="/login?mode=signup"');
  });

  it("shows the accepted repair again when the learner comes back from the retest", () => {
    const today = new Date().toISOString().slice(0, 10);
    // "one / two / three" has no clear claim, so the weakness is Claim.
    const text = "Cities should scrap parking minimums because they push up the cost of new homes.";
    const html = renderAtStage({
      version: 1,
      motionDate: today,
      stage: "result",
      side: "for",
      responses: ["one", "two", "three"],
      repair: { kind: "claim", label: "Claim", text, succeeded: true },
      retestDemonstrated: null,
    });
    expect(html).toContain("Now prove it in a fresh debate");
    // Not an empty rewrite box: the accepted repair (or its feedback) is shown.
    expect(html).not.toMatch(/<textarea[^>]*id="guest-repair-response"[^>]*><\/textarea>/);
    expect(html).toContain('data-testid="guest-repair-feedback"');
  });

  it("ties the debate textarea to its minimum-length counter", () => {
    const today = new Date().toISOString().slice(0, 10);
    const html = renderAtStage({ version: 1, motionDate: today, stage: "debate", side: "for", responses: [], repair: null, retestDemonstrated: null });
    expect(html).toContain('aria-describedby="guest-response-count"');
    expect(html).toContain('id="guest-response-count"');
  });
});
