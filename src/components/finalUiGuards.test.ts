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
    expect(lobby).toContain('<div role="status" className="flex flex-col items-center gap-4">');
    expect(source("src/components/ExploreVote.tsx")).toContain('<div className="explore-vote-result" role="status">');
  });
});
