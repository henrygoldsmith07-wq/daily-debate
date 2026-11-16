import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("UI detail guards", () => {
  it("the review disclosure exposes its expanded state and panel", () => {
    const s = source("src/components/CorpusAdmin.tsx");
    expect(s).toContain("aria-expanded={expandedId === id}");
    expect(s).toContain('aria-controls={`review-panel-${id}`}');
    expect(s).toContain('id={`review-panel-${id}`}');
    expect(s).toContain('aria-label={`Override winner:');
  });

  it("auth tabs move focus with arrow-key selection", () => {
    const s = source("src/app/login/AuthForm.tsx");
    expect(s).toMatch(/selectMode\(next\);[\s\S]{0,300}auth-tab-signin[\s\S]{0,120}\.focus\(\)/);
  });

  it("the friend-challenge link shown is the same absolute URL that is copied", () => {
    const s = source("src/components/PvpLobby.tsx");
    expect(s).toContain("new URL(data.url, window.location.origin).href");
    expect(s).not.toContain("window.location.origin + invite.url");
    expect(s).toContain("clipboard.writeText(invite.url)");
  });

  it("keeps an accessible name on the copy-summary button", () => {
    const s = source("src/components/debate/DebateResultCard.tsx");
    expect(s).toContain('aria-label="Copy summary"');
  });

  it("gives the reminder toggle the base btn class", () => {
    const s = source("src/components/ReminderOptInPanel.tsx");
    expect(s).toContain('className="btn btn-secondary mt-3"');
  });

  it("resolves the Recently improved section label reference", () => {
    const s = source("src/app/progress/page.tsx");
    expect(s).toContain('aria-labelledby="recent-improved"');
    expect(s).toContain('id="recent-improved" className="text-xs uppercase');
  });

  it("labels the guest result region with its caption, not the numeric score", () => {
    const s = source("src/components/GuestArena.tsx");
    expect(s).toContain('aria-labelledby="guest-headline-caption"');
    expect(s).toContain('id="guest-headline-caption" className="result-headline-caption"');
  });
});
