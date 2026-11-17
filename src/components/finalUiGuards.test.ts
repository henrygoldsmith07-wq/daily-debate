import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("final UI detail guards", () => {
  it("does not wrap score buttons in a label that would name the first button", () => {
    const s = source("src/components/RateForm.tsx");
    expect(s).not.toContain("<label key={dim}");
    expect(s).toContain("<div key={dim}");
  });

  it("exposes the compact level progress and DNA score explanation as text", () => {
    expect(source("src/components/AppShell.tsx")).toContain(
      '<span className="sr-only">, {pointsIntoLevel(points)} of {POINTS_PER_LEVEL} toward level {level}</span>',
    );
    expect(source("src/components/ArgumentDnaView.tsx")).toContain(
      '<span className="sr-only">Length-normalised debate score: </span>',
    );
  });

  it("conveys the per-round marks in the shared-result image label", () => {
    expect(source("src/lib/shareCard.ts")).toContain('{ mark: "none", label: "nothing to answer" }');
    const s = source("src/app/s/page.tsx");
    expect(s).toContain("One square per round:");
    expect(s).toContain("card.marks.map((mark, i)");
    expect(s).toContain("MARK_LEGEND.find((item) => item.mark === mark)?.label");
  });

  it("does not make per-keystroke character counters live regions", () => {
    for (const [file, id] of [
      ["src/components/GuestArena.tsx", "guest-repair-count"],
      ["src/components/GuestArena.tsx", "guest-retest-count"],
      ["src/components/ArgumentRepair.tsx", "repair-draft-count"],
    ]) {
      const s = source(file);
      const at = s.indexOf(`id="${id}"`);
      expect(at).toBeGreaterThan(-1);
      const tag = s.slice(s.lastIndexOf("<", at), s.indexOf(">", at) + 1);
      expect(tag).not.toContain("aria-live");
    }
    // Threshold readiness is still announced through a separate two-state region.
    expect(source("src/components/GuestArena.tsx")).toContain(
      '<span className="sr-only" role="status">{repair.trim().length >= 12 ? "Ready to submit." : ""}</span>',
    );
    expect(source("src/components/ArgumentRepair.tsx")).toContain(
      '<span className="sr-only" role="status">{draft.trim().length >= 10 ? "Ready to submit." : ""}</span>',
    );
  });

  it("keeps the guest privacy disclosure free of duplicated clauses", () => {
    const s = source("src/components/GuestArena.tsx");
    expect(s).not.toContain("may log them: your answers go to");
    expect(s).toContain("An AI provider receives your answers for replies and may log them. Practice is saved only in this browser tab.");
  });

  it("moves focus to the deletion confirmation field", () => {
    const s = source("src/components/AccountDataControls.tsx");
    expect(s).toContain("confirmRef.current?.focus()");
    expect(s).toContain("ref={confirmRef}");
  });

  it("announces feedback confirmation and keeps focus on matchmaking start", () => {
    expect(source("src/components/debate/DebateResultCard.tsx")).toContain(
      '<p role="status" className="text-xs text-ink3" data-testid="weakness-feedback-thanks">',
    );
    const lobby = source("src/components/PvpLobby.tsx");
    expect(lobby).toContain("searchStatusRef.current?.focus()");
    expect(lobby).toContain('ref={searchStatusRef} tabIndex={-1} role="status"');
  });

  it("gives the PvP room and password-reset screens a document heading", () => {
    expect(source("src/components/PvpRoom.tsx")).toContain(
      '<h1 className="text-xs uppercase tracking-wide text-ink3">{topic.title}</h1>',
    );
    for (const f of [
      "src/app/login/forgot-password/ForgotPasswordForm.tsx",
      "src/app/login/reset-password/ResetPasswordForm.tsx",
    ]) {
      const s = source(f);
      expect(s).not.toMatch(/<h2 className="font-semibold">/);
      expect(s).toContain('<h1 className="font-semibold">');
    }
  });

  it("announces password-reset success panels", () => {
    for (const f of [
      "src/app/login/forgot-password/ForgotPasswordForm.tsx",
      "src/app/login/reset-password/ResetPasswordForm.tsx",
    ]) {
      const s = source(f);
      expect(s).toMatch(/role="status" className="surface-raised flex w-full max-w-sm flex-col gap-4 p-6 text-center"/);
    }
  });

  it("announces copy outcome and search/vote state changes", () => {
    const lobby = source("src/components/PvpLobby.tsx");
    expect(lobby).toContain('setCopyState("copied")');
    expect(lobby).toContain('setCopyState("failed")');
    expect(lobby).toContain("Link copied");
    expect(lobby).toContain('<span role="status" className="text-xs text-ink3">');
    expect(lobby).toContain('ref={searchStatusRef} tabIndex={-1} role="status" className="flex flex-col items-center gap-4">');
    expect(source("src/components/ExploreVote.tsx")).toContain('<div className="explore-vote-result" role="status">');
  });
});
