import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import GuestArena, { GuestArenaSession } from "./GuestArena";
import { encodeGuestArenaProgress, GUEST_ARENA_STORAGE_KEY } from "@/lib/guestLoop";

// First-visit snags a new user hits on the guest page. The hydrated session is
// rendered statically (node env): a stubbed sessionStorage restores a later
// stage the way a reload does. The default export keeps the server home on its
// first render, so it must not read storage until hydration.

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
  return renderToStaticMarkup(<GuestArenaSession canRestore validation={null} liveMotion={live} />);
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
    expect(html).toContain("An AI provider receives your answers for replies and may log them");
    expect(html).toContain("Practice is saved only in this browser tab");
    expect(html).toContain("Use a guided case instead");
    // The local-only promise is never shown next to the live opponent.
    expect(html).not.toContain("stays on this device");
  });

  it("stays on the guided case, with its local-only promise, when live is not offered", () => {
    const html = renderAtStage(null, null);
    expect(html).toContain("Guided case");
    expect(html).toContain("Guided practice stays on this device");
    expect(html).not.toContain('data-testid="guest-mode-switch"');
  });

  it("resumes a live sprint only after hydration, then names the opponent", () => {
    const today = new Date().toISOString().slice(0, 10);
    const saved = {
      version: 1 as const,
      motionDate: today,
      stage: "debate" as const,
      side: "for" as const,
      responses: ["Cities should ban cars because clean air protects children."],
      repair: null,
      retestDemonstrated: null,
      mode: "live" as const,
      live: {
        motion: LIVE,
        persona: "lawyer" as const,
        opponents: ["Cars carry people buses cannot.", "Which study shows the health gain?"],
        retest: null,
      },
    };
    const html = renderAtStage(saved, LIVE);
    // The server and the first client render must match: the saved transcript
    // stays out of the initial markup, so hydration cannot mismatch.
    const firstRender = renderToStaticMarkup(<GuestArena live={LIVE} />);
    expect(firstRender).not.toContain("Which study shows the health gain?");
    expect(firstRender).toContain("Start a free practice");
    // Once hydrated, the same session mounts with the saved loop.
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
