import { beforeEach, describe, expect, it, vi } from "vitest";

// The loader reads `profiles.guest_context` and re-validates it. Two behaviours
// matter and neither was covered before this module existed:
//   1. a schema-lagging database (migration 036 not applied) degrades to null
//      rather than failing the page — the same tolerance the write path has;
//   2. a malformed or hand-edited column value never reaches a surface.
const h = vi.hoisted(() => ({
  mode: "ok" as "ok" | "read-error" | "missing-column" | "no-row",
  value: null as unknown,
}));

vi.mock("@/lib/backend/server", () => ({
  createClient: () => ({
    from() {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        single() {
          if (h.mode === "missing-column") {
            return Promise.resolve({
              data: null,
              error: {
                code: "42703",
                message: 'column profiles.guest_context of relation "profiles" does not exist',
              },
            });
          }
          if (h.mode === "read-error") {
            return Promise.resolve({ data: null, error: { message: "connection reset" } });
          }
          if (h.mode === "no-row") return Promise.resolve({ data: null, error: null });
          return Promise.resolve({ data: { guest_context: h.value }, error: null });
        },
      };
      return builder;
    },
  }),
}));

const { getGuestContext } = await import("./guestContextServer");

const VALID = {
  motion: "Should every school day include a phone-free hour?",
  weaknessKind: "evidence",
  weaknessLabel: "Unsupported claim",
  repairState: "repair_demonstrated",
  repairSucceeded: true,
  retestOutcome: "observed",
  completedAt: "2026-10-04T00:00:00.000Z",
};

describe("getGuestContext", () => {
  beforeEach(() => {
    h.mode = "ok";
    h.value = null;
  });

  it("returns a validated summary when the column holds one", async () => {
    h.value = VALID;
    expect(await getGuestContext("u1")).toEqual(VALID);
  });

  it("re-validates on read — an invalid enum is dropped, never surfaced", async () => {
    h.value = { ...VALID, weaknessKind: "pvp" };
    expect(await getGuestContext("u1")).toBeNull();
  });

  it("drops a non-object column value", async () => {
    h.value = "not-an-object";
    expect(await getGuestContext("u1")).toBeNull();
  });

  it("degrades to null when migration 036 has not been applied", async () => {
    h.mode = "missing-column";
    expect(await getGuestContext("u1")).toBeNull();
  });

  it("degrades to null on a read error rather than throwing", async () => {
    h.mode = "read-error";
    expect(await getGuestContext("u1")).toBeNull();
  });

  it("returns null when no profile row exists", async () => {
    h.mode = "no-row";
    expect(await getGuestContext("u1")).toBeNull();
  });
});
