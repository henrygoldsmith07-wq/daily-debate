import { describe, it, expect } from "vitest";
import { startSoloDebate } from "./startDebate";
import { FALLBACK_IN_MEMORY_TOPIC_ID } from "../dailyTopic";
import { DEFAULT_DIFFICULTY, DEFAULT_PERSONA } from "../opponentPersona";
import type { BackendClient } from "../backend/client";

// The sentinel check runs before any database access: a client that throws
// on any use proves the service never touches the store for it.
const throwingDb = new Proxy(
  {},
  {
    get: () => () => {
      throw new Error("database must not be touched for the fallback sentinel");
    },
  },
) as unknown as BackendClient;

describe("startSoloDebate in-memory fallback topic", () => {
  it("answers 503 retryable instead of a misleading 404", async () => {
    const result = await startSoloDebate({
      db: throwingDb,
      userId: "user-1",
      topicId: FALLBACK_IN_MEMORY_TOPIC_ID,
      sideChoice: "for",
      format: "sprint",
      persona: DEFAULT_PERSONA,
      difficulty: DEFAULT_DIFFICULTY,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
      expect(result.code).toBe("topic-store-unavailable");
    }
  });
});
