import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MessageComposer from "./MessageComposer";
import { saveDraft } from "@/lib/composerDraft";

function stubWindow() {
  const m = new Map<string, string>();
  const sessionStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
  (globalThis as unknown as { window: unknown }).window = { sessionStorage };
  return sessionStorage;
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("MessageComposer draft restore", () => {
  it("restores an unsent draft for the same key", () => {
    stubWindow();
    saveDraft("solo:1:open", "Tariffs raise prices because");
    const html = renderToStaticMarkup(<MessageComposer onSubmit={() => {}} disabled={false} draftKey="solo:1:open" />);
    expect(html).toContain("Tariffs raise prices because");
  });
  it("does not leak a draft into a different debate", () => {
    stubWindow();
    saveDraft("solo:1:open", "private words");
    const html = renderToStaticMarkup(<MessageComposer onSubmit={() => {}} disabled={false} draftKey="solo:2:open" />);
    expect(html).not.toContain("private words");
  });
  it("saved server text wins over a local draft", () => {
    stubWindow();
    saveDraft("k", "local");
    const html = renderToStaticMarkup(<MessageComposer onSubmit={() => {}} disabled={false} draftKey="k" initialText="server" />);
    expect(html).toContain("server");
    expect(html).not.toContain("local");
  });
});
