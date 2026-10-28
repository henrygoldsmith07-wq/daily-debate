import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RateQueueState } from "./RateForm";

describe("RateForm load state", () => {
  it("does not disguise a failed queue request as an empty queue", () => {
    const html = renderToStaticMarkup(
      <RateQueueState
        error="Failed to load an item."
        emptyNote="No unrated items available."
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Failed to load an item.");
    expect(html).toContain("Try again");
    expect(html).not.toContain("No unrated items available.");
  });

  it("keeps the exhausted-queue message separate from the error state", () => {
    const html = renderToStaticMarkup(
      <RateQueueState error={null} emptyNote="No unrated items available." onRetry={vi.fn()} />,
    );

    expect(html).toContain("No unrated items available.");
    expect(html).not.toContain('role="alert"');
  });
});
