import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createJiti } from "jiti";
import { scoreCandidate } from "./generate-topics.mjs";

const jiti = createJiti(import.meta.url);
const { scoreTopic } = await jiti.import("../src/lib/topicScoring.ts");

// The pipeline used to carry its own 5-dimension approximation of the rubric in
// src/lib/topicScoring.ts, while the real 9-dimension scorer was exercised only
// by its own unit test. That meant the scored behaviour under test was never the
// behaviour in production, and the dimensions that actually guard against bad
// topics (age appropriateness, factual grounding, source diversity, and the
// negative recency penalty) did nothing at all.
//
// These tests pin the delegation: the pipeline's score must be the canonical
// scorer's score, and the guard dimensions must actually bite.

describe("scoreCandidate delegates to the canonical 9-dimension rubric", () => {
  it("returns the canonical composite as _score", async () => {
    const topic = {
      title: "Should cities ban private cars from their centres?",
      prompt: "Do the benefits of removing cars from city centres outweigh the cost to residents who depend on them?",
      category: "Transport",
    };
    const scored = await scoreCandidate(topic, []);
    const breakdown = scored._breakdown;

    // The canonical scorer is the single source of the number.
    const expected = scoreTopic(topic, []);
    assert.equal(scored._score, expected.total);
    assert.ok(breakdown.total > 0 && breakdown.total <= 10, `unexpected total ${breakdown.total}`);
  });

  it("exposes the full 9-dimension breakdown, not the old 5", async () => {
    const scored = await scoreCandidate(
      { title: "Should the voting age be lowered to sixteen?", prompt: "Is sixteen the right age for political standing?", category: "Civic life" },
      [],
    );
    for (const dim of [
      "debatableBalance",
      "evidenceAvailability",
      "novelty",
      "specificity",
      "ageAppropriateness",
      "factualGrounding",
      "ideologicalLoading",
      "sourceDiversity",
      "recentSimilarityPenalty",
    ]) {
      assert.ok(dim in scored._breakdown, `missing dimension: ${dim}`);
    }
  });

  it("penalises a topic that resembles a recent one", async () => {
    const topic = {
      title: "Should schools ban phones during the school day?",
      prompt: "Does a phone ban protect learning time?",
      category: "Education",
    };
    const fresh = await scoreCandidate(topic, []);
    const repetitive = await scoreCandidate(topic, [
      "Should schools ban phones during the school day?",
      "Schools should ban phones during lessons",
    ]);
    assert.ok(
      repetitive._score < fresh._score,
      `recency penalty did not apply: fresh=${fresh._score} repetitive=${repetitive._score}`,
    );
  });

  it("flags a one-sided topic through the notes, as the canonical rubric does", async () => {
    const scored = await scoreCandidate(
      { title: "Obviously everyone knows this policy is clearly bad without question", prompt: "No debate about it.", category: "Policy" },
      [],
    );
    assert.ok(scored._breakdown.notes.length > 0, "one-sided topic should be annotated");
    assert.ok(scored._breakdown.notes.some((n) => /one-sided/i.test(n)));
  });

  it("survives a candidate with missing fields", async () => {
    const scored = await scoreCandidate({ title: "T", prompt: "P", category: "C" }, undefined);
    assert.equal(typeof scored._score, "number");
    assert.ok(Number.isFinite(scored._score));
  });
});
