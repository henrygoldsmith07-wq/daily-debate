import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ArgumentRepair from "./ArgumentRepair";
import type { ArgGraph } from "@/lib/argGraph";
import type { RepairTarget } from "@/lib/argumentRepair";

describe("ArgumentRepair", () => {
  it("links the repair textarea to its character counter", () => {
    const target = { kind: "unsupported_claim", title: "T", prompt: "P" } as unknown as RepairTarget;
    const html = renderToStaticMarkup(
      <ArgumentRepair graph={{} as ArgGraph} presetTarget={target} />,
    );
    expect(html).toContain('aria-describedby="repair-draft-count"');
    expect(html).toContain('id="repair-draft-count"');
  });

  it("does not offer help before a failed attempt", () => {
    const target = { kind: "unsupported_claim", title: "T", prompt: "P" } as unknown as RepairTarget;
    const html = renderToStaticMarkup(
      <ArgumentRepair graph={{} as ArgGraph} presetTarget={target} />,
    );
    expect(html).not.toContain('data-testid="repair-help"');
    expect(html).not.toContain("reveal-help-");
  });
});
