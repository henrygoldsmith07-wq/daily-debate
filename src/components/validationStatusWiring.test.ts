import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * VALIDATION-STATUS WIRING TESTS.
 *
 * Deliverable: the judge-validation state is product data on the surfaces
 * themselves, not just a table on /metrics. The host pages load the report
 * (one artifact, one reading) and hand each surface its own entry; the
 * components render the entry verbatim through ValidationStatusLine. These
 * tests pin that chain, because a wiring break here degrades silently into
 * "the honesty copy exists somewhere" while every score keeps rendering
 * without its measured caveat.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts: string[]) => readFileSync(path.join(ROOT, "src", ...parts), "utf8");

describe("judge-validation status reaches the surfaces that render judge output", () => {
  it("the debate page loads the report and passes the solo + repair entries down", () => {
    const page = read("app", "debate", "[debateId]", "page.tsx");
    expect(page).toContain('loadJudgeValidation()');
    expect(page).toContain('validation.surfaces["solo-training"]');
    expect(page).toContain("validation.surfaces.repair");
    // Both entries reach the room as props, so every judge-output view inside
    // (live scores and the result card) can broadcast the same verdict.
    expect(page).toContain("soloValidation={validation.surfaces[");
    expect(page).toContain("repairValidation={validation.surfaces.repair}");
  });

  it("DebateRoom forwards both entries into DebateResultCard", () => {
    const room = read("components", "DebateRoom.tsx");
    expect(room).toContain("soloValidation = null,");
    expect(room).toContain("repairValidation = null,");
    const forwarded = room.slice(room.indexOf("<DebateResultCard"), room.indexOf("</DebateResultCard") > 0 ? room.indexOf("</DebateResultCard") : room.length);
    expect(forwarded).toContain("soloValidation={soloValidation}");
    expect(forwarded).toContain("repairValidation={repairValidation}");
  });

  it("the result card renders the solo line beside the scores and feeds the repair panel", () => {
    const card = read("components", "debate", "DebateResultCard.tsx");
    // The line is mounted in the card (testId per surface), not invented copy.
    expect(card).toContain('<ValidationStatusLine validation={soloValidation} testId="solo-validation-state" />');
    expect(card).toContain("validation={repairValidation}");
  });

  it("ArgumentRepair renders the entry it was given", () => {
    const repair = read("components", "ArgumentRepair.tsx");
    expect(repair).toContain('<ValidationStatusLine validation={validation} testId="repair-validation-state" />');
  });

  it("the dashboard passes the guest entry to GuestArena on both visitor paths", () => {
    const page = read("app", "page.tsx");
    expect(page).toContain('loadJudgeValidation().surfaces["guest"]');
    // Both visitor paths (no database, signed out) pass it; the signed-out
    // path also passes today's live motion.
    expect(page.match(/<GuestArena\s+validation=\{guestValidation\}/g)?.length).toBe(2);
  });

  it("GuestArena threads the entry into its result view", () => {
    const arena = read("components", "GuestArena.tsx");
    expect(arena).toContain("validation?: SurfaceValidation | null");
    expect(arena).toContain('<ValidationStatusLine validation={validation} testId="guest-validation-state" />');
    // The stage switch must actually pass it (a prop that never reaches
    // GuestResult would make the line read "could not be read" forever).
    expect(arena).toContain("validation={validation}");
  });

  it("the line component never re-declares a claim of its own beyond the unknown fallback", () => {
    const line = read("components", "ValidationStatusLine.tsx");
    // The fallback when the host could not load anything is the ONLY sentence
    // this component may state; it must be a refusal, never a validated claim.
    expect(line).toContain("may not be described as validated");
    expect(line).not.toContain("validated by");
  });
});
