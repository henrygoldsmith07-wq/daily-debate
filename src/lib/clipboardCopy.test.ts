import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboardCopy";

// PvpLobby's "Copy link" used to call navigator.clipboard.writeText(...) with
// no guard, which throws a TypeError on insecure origins (the exact failure
// DebateResultCard guards against inline) and gave the reader no feedback.
// copyText must never throw, must fall back when the async clipboard API is
// missing or rejects, and must report what actually happened.

describe("copyText", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns copied when the async clipboard API succeeds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await copyText("https://example.com/challenge/ABC", { clipboard: { writeText } })).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("https://example.com/challenge/ABC");
  });

  it("falls back to the legacy path when navigator.clipboard is absent", async () => {
    const legacy = vi.fn(() => true);
    expect(await copyText("text", { clipboard: null, execCommandCopy: legacy })).toBe("copied");
    expect(legacy).toHaveBeenCalledWith("text");
  });

  it("respects an explicitly absent clipboard even when the global API exists", async () => {
    const globalWriteText = vi.fn().mockResolvedValue(undefined);
    const legacy = vi.fn(() => true);
    vi.stubGlobal("navigator", { clipboard: { writeText: globalWriteText } });

    expect(await copyText("text", { clipboard: null, execCommandCopy: legacy })).toBe("copied");
    expect(globalWriteText).not.toHaveBeenCalled();
    expect(legacy).toHaveBeenCalledWith("text");
  });

  it("falls back when the async write rejects (permission denied) instead of throwing", async () => {
    const legacy = vi.fn(() => true);
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    expect(await copyText("text", { clipboard: { writeText }, execCommandCopy: legacy })).toBe("copied");
    expect(legacy).toHaveBeenCalledWith("text");
  });

  it("reports failed rather than throwing when every path is unavailable", async () => {
    expect(await copyText("text", { clipboard: null, execCommandCopy: () => false })).toBe("failed");
  });

  it("never rejects even when the clipboard lookup itself throws", async () => {
    const writeText = vi.fn(() => {
      throw new TypeError("navigator.clipboard is undefined");
    });
    expect(await copyText("text", { clipboard: { writeText } as never, execCommandCopy: () => false })).toBe("failed");
  });
});
