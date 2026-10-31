import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import GuestArena from "./GuestArena";
import { encodeGuestArenaProgress, GUEST_ARENA_STORAGE_KEY } from "@/lib/guestLoop";

// First-visit snags a new user hits on the guest page. Rendered statically
// (node env): with no `window`, the arena restores to the guest home; a
// stubbed sessionStorage restores a later stage the way a reload would.

const FLAG = "NEXT_PUBLIC_EXPERIMENTAL_SURFACES";

const LIVE = { title: "Should cities ban private cars from their centres?", prompt: "Weigh access against air.", category: "Policy" };

function renderAtStage(
  progress: Parameters<typeof encodeGuestArenaProgress>[0] | null,
  live: typeof LIVE | null = null,
): string {
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
  return renderToStaticMarkup(<GuestArena live={live} />);
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

  it("offers today's motion against the live AI opponent, and says where answers go", () => {
    const html = renderAtStage(null, LIVE);
    expect(html).toContain(LIVE.title);
    expect(html).toContain("Live AI opponent");
    expect(html).toContain("go to a free-tier AI provider, which may log them");
    expect(html).toContain("We store nothing you write");
    expect(html).toContain("Use a guided case instead");
    // The local-only promise is never shown next to the live opponent.
    expect(html).not.toContain("Your guest practice stays on this device");
  });

  it("stays on the guided case, with its local-only promise, when live is not offered", () => {
    const html = renderAtStage(null, null);
    expect(html).toContain("Guided case");
    expect(html).toContain("Your guest practice stays on this device");
    expect(html).not.toContain('data-testid="guest-mode-switch"');
  });

  it("resumes a live sprint from its stored transcript and names the opponent", () => {
    const today = new Date().toISOString().slice(0, 10);
    const html = renderAtStage({
      version: 1,
      motionDate: today,
      stage: "debate",
      side: "for",
      responses: ["Cities should ban cars because clean air protects children."],
      repair: null,
      retestDemonstrated: null,
      mode: "live",
      live: {
        motion: LIVE,
        persona: "lawyer",
        opponents: ["Cars carry people buses cannot.", "Which study shows the health gain?"],
        retest: null,
      },
    }, LIVE);
    expect(html).toContain(LIVE.title);
    expect(html).toContain("Which study shows the health gain?");
    expect(html).toContain("Opponent · The Lawyer");
  });

  it("keeps the composer closed until a live opponent has answered", () => {
    const today = new Date().toISOString().slice(0, 10);
    const html = renderAtStage({
      version: 1,
      motionDate: today,
      stage: "debate",
      side: "for",
      responses: [],
      repair: null,
      retestDemonstrated: null,
      mode: "live",
      live: { motion: LIVE, persona: "balanced", opponents: [], retest: null },
    }, LIVE);
    expect(html).toContain("Opponent is thinking");
    expect(html).toMatch(/<textarea[^>]*id="guest-response"[^>]*disabled=""/);
  });
});
