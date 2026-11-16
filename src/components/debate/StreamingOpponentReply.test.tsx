import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import StreamingOpponentReply from "./StreamingOpponentReply";

describe("StreamingOpponentReply", () => {
  it("shows the thinking indicator before the first token", () => {
    const html = renderToStaticMarkup(<StreamingOpponentReply text={null} />);
    expect(html).toContain("AI is thinking");
    expect(html).not.toContain('data-testid="streaming-reply"');
  });

  it("renders the reply incrementally as text arrives, with a typing caret", () => {
    const tokens = ["But ", "who ", "pays ", "for ", "it?"];
    let text = "";
    const renders = tokens.map((t) => {
      text += t;
      return renderToStaticMarkup(<StreamingOpponentReply text={text} />);
    });
    renders.forEach((html, i) => {
      expect(html).toContain(tokens.slice(0, i + 1).join(""));
      expect(html).toContain('data-testid="streaming-reply"');
      expect(html).toContain("animate-pulse");
    });
    expect(renders[1]).not.toContain("pays");
    expect(renders[4]).toContain("But who pays for it?");
  });

  it("hides partial text from assistive tech and announces one status instead", () => {
    const html = renderToStaticMarkup(<StreamingOpponentReply text="Partial reply" />);
    expect(html).toMatch(/aria-hidden="true"[^>]*>Partial reply/);
    expect(html).toContain('role="status"');
    expect(html).toContain("Opponent is replying");
  });
});
