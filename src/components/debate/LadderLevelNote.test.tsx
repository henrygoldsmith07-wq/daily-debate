import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LadderLevelNote from "./LadderLevelNote";

describe("LadderLevelNote", () => {
  it("renders nothing without an earned level", () => {
    expect(renderToStaticMarkup(<LadderLevelNote level={null} />)).toBe("");
  });
  it("names the level and keeps the unvalidated label", () => {
    const html = renderToStaticMarkup(<LadderLevelNote level="hardest" />);
    expect(html).toContain("Retest level: hardest");
    expect(html).toContain("not a validated skill score");
  });
});
