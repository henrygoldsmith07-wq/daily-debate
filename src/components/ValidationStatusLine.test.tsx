import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ValidationStatusLine from "./ValidationStatusLine";
import type { SurfaceValidation } from "@/lib/judgeValidation";
import { assessJudgeValidation } from "@/lib/judgeValidation";

// The line a host page renders for its surface must carry the module's own
// verdict and claim — verbatim. The host page may choose WHERE to show it,
// never WHAT it says, so these tests pin the text against hand-built states
// and against a report the pure module actually produced.

function surface(overrides: Partial<SurfaceValidation> = {}): SurfaceValidation {
  return {
    surface: "repair",
    status: "provisional",
    claim: "Weak-link repair outputs are practice feedback measured against an unvalidated benchmark — not a validated ability score.",
    reason: "0/3 models cleared every gate.",
    evidence: null,
    runAt: "2026-10-04T21:35:36.030Z",
    stale: false,
    source: "ok",
    ...overrides,
  };
}

describe("ValidationStatusLine", () => {
  it("renders the status chip and the module's claim verbatim", () => {
    const html = renderToStaticMarkup(<ValidationStatusLine validation={surface()} />);
    expect(html).toContain("provisional");
    expect(html).toContain("not a validated ability score");
    // The host cannot silently upgrade the claim: the status word appears.
    expect(html).toContain("validation:");
  });

  it("never renders a validated chip as a generic neutral pill", () => {
    const validated = renderToStaticMarkup(
      <ValidationStatusLine validation={surface({ status: "validated" })} testId="v-line" />,
    );
    expect(validated).toContain("validated");
    expect(validated).toContain("data-testid=\"v-line\"");
  });

  it("styles unknown and gated-off like blocked states, not like fine ones", () => {
    for (const status of ["unknown", "gated-off"] as const) {
      const html = renderToStaticMarkup(<ValidationStatusLine validation={surface({ status })} />);
      expect(html).toContain("--danger");
      expect(html).not.toContain("--success");
    }
  });

  it("a null entry states the hole in the evidence instead of vanishing", () => {
    const html = renderToStaticMarkup(<ValidationStatusLine validation={null} />);
    expect(html).toContain("validation: unknown");
    expect(html).toContain("could not be read");
    expect(html).toContain("may not be described as validated");
  });

  it("carries the claim the pure module actually produces, unchanged", () => {
    // Derive the guest surface from a real (not-passing) artifact — the same
    // reduction the server loader runs — and assert the line repeats its
    // claim text exactly (no rewording layer in between).
    const report = assessJudgeValidation({
      nowIso: "2026-10-10T00:00:00Z",
      artifact: {
        at: "2026-10-04T21:35:36.030Z",
        allPass: false,
        gates: { humanAgreementMin: 0.75, eceMax: 0.08, positionSwapMin: 0.97, fakeCitationMax: 0.05 },
        results: [{ model: "m1", humanAgreement: 0.583, agreementN: 24, ece: 0.189, gates: null }],
      },
    });
    const guest = report.surfaces["guest"];
    expect(guest.status).toBe("provisional");
    const html = renderToStaticMarkup(
      <ValidationStatusLine validation={guest} testId="guest-validation-state" />,
    );
    expect(html).toContain(guest.claim);
  });
});
