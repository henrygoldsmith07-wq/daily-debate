import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import RetestStartButton from "./RetestStartButton";

describe("RetestStartButton", () => {
  it("renders the one-tap start without naming a skill or day", () => {
    const html = renderToStaticMarkup(<RetestStartButton topicId="t1" label="Start today's debate" />);
    expect(html).toContain('data-testid="priority-retest"');
    expect(html).toContain("Start today&#x27;s debate");
    expect(html).not.toMatch(/evidence|rebuttal|logic|impact|structure|clarity/i);
  });
});
