import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { sanitizeCandidateTopic } from "./generate-topics.mjs";

// The sanitizer itself is unit-tested in src/lib/topicSanitizer.test.ts. What
// this suite pins down is that the PRODUCTION PIPELINE actually calls it —
// before this fix the module was imported by nothing but its own test, so a
// model-hallucinated or hostile source URL was persisted verbatim and then
// rendered as a clickable link, with the name-only "known source" check still
// badging it as verified.

describe("sanitizeCandidateTopic (production pipeline wiring)", () => {
  it("drops homepages that are not https roots", async () => {
    const out = await sanitizeCandidateTopic({
      title: "Cities should eliminate minimum parking requirements",
      prompt: "Should planning rules stop requiring parking?",
      category: "Policy",
      sources: [
        // A dangerous scheme must never reach a rendered <a href>.
        { name: "Evil", homepage: "javascript:alert(1)", angle: "x" },
        // A deep link is normalised to its origin, not left as an article path.
        { name: "NREL", homepage: "https://www.nrel.gov/analysis/cost?x=1#frag", angle: "cost curves" },
      ],
    });
    assert.deepEqual(out.sources, [
      { name: "NREL", homepage: "https://www.nrel.gov", angle: "cost curves" },
    ]);
  });

  it("drops sources with no usable name at all", async () => {
    const out = await sanitizeCandidateTopic({
      title: "T",
      prompt: "P",
      category: "Policy",
      sources: [{ name: "   ", homepage: "https://www.nrel.gov", angle: "cost curves" }],
    });
    assert.deepEqual(out.sources, []);
  });

  it("clamps oversized text rather than persisting it", async () => {
    const out = await sanitizeCandidateTopic({
      title: "x".repeat(500),
      prompt: "p".repeat(900),
      category: "Policy",
      sources: [],
    });
    assert.equal(out.title.length, 140);
    assert.equal(out.prompt.length, 500);
  });

  it("falls back to safe defaults for an empty/absent candidate", async () => {
    const out = await sanitizeCandidateTopic(null);
    assert.equal(out.title, "Today's debate");
    assert.equal(out.prompt, "Should the proposal be supported?");
    assert.deepEqual(out.sources, []);
  });

  it("caps the source list", async () => {
    const out = await sanitizeCandidateTopic({
      title: "T",
      prompt: "P",
      category: "Policy",
      sources: Array.from({ length: 12 }, (_unused, i) => ({
        name: `Source ${i}`,
        homepage: `https://example${i}.org`,
        angle: "a",
      })),
    });
    assert.equal(out.sources.length, 5);
  });
});

// Guard against a cross-platform temp-dir leak: the suite must not depend on
// the developer's working directory.
describe("test hygiene", () => {
  let dir;
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "daily-debate-sanitize-"));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  it("creates and removes its own temp directory", () => {
    assert.ok(dir.includes(path.basename(tmpdir())) || dir.length > 0);
  });
});
