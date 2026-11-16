import { describe, expect, it, vi } from "vitest";
import { startRetestRequest } from "./startRetestRequest";

const resp = (ok: boolean, body: unknown) => ({ ok, json: async () => body }) as Response;

describe("startRetestRequest", () => {
  it("posts a hint-free sprint start and returns the debate id", async () => {
    const f = vi.fn().mockResolvedValue(resp(true, { debate: { id: "d9" } }));
    const r = await startRetestRequest("t1", f as unknown as typeof fetch, true);
    expect(r).toEqual({ ok: true, debateId: "d9" });
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body).toEqual({ topicId: "t1", side: "challenge", format: "sprint" });
  });
  it("surfaces server errors, network errors and offline", async () => {
    const bad = vi.fn().mockResolvedValue(resp(false, { error: "Nope" }));
    expect(await startRetestRequest("t", bad as unknown as typeof fetch, true)).toEqual({ ok: false, error: "Nope" });
    const net = vi.fn().mockRejectedValue(new TypeError("x"));
    expect((await startRetestRequest("t", net as unknown as typeof fetch, true)) as { error: string }).toMatchObject({ error: expect.stringContaining("Network") });
    expect(await startRetestRequest("t", bad as unknown as typeof fetch, false)).toMatchObject({ ok: false });
    expect(bad).toHaveBeenCalledTimes(1);
  });
  it("rejects a response with no debate id", async () => {
    const f = vi.fn().mockResolvedValue(resp(true, {}));
    expect(await startRetestRequest("t", f as unknown as typeof fetch, true)).toMatchObject({ ok: false });
  });
});
