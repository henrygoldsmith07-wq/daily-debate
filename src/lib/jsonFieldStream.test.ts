import { describe, expect, it } from "vitest";
import { createJsonFieldStream } from "./jsonFieldStream";

/** Feed `text` in pieces of `size` and collect what was emitted per push. */
function feed(text: string, size: number, field = "aiMessage") {
  const s = createJsonFieldStream(field);
  const pieces: string[] = [];
  for (let i = 0; i < text.length; i += size) pieces.push(s.push(text.slice(i, i + size)));
  return { stream: s, pieces };
}

const DOC = JSON.stringify({ feedback: "Cite a source.", aiMessage: 'But "who" pays?\nConsider costs — 🌍 too.' });

describe("createJsonFieldStream", () => {
  it.each([1, 2, 3, 7, 1000])("decodes the field identically in %i-char chunks", (size) => {
    const { stream } = feed(DOC, size);
    expect(stream.value).toBe('But "who" pays?\nConsider costs — 🌍 too.');
    expect(stream.complete).toBe(true);
  });

  it("emits text incrementally, before the object is complete", () => {
    const s = createJsonFieldStream("aiMessage");
    expect(s.push('{"aiMessage":"Hel')).toBe("Hel");
    expect(s.push("lo wor")).toBe("lo wor");
    expect(s.complete).toBe(false);
    expect(s.push('ld","feedback":"x"}')).toBe("ld");
    expect(s.value).toBe("Hello world");
  });

  it("never emits the other fields (feedback stays private)", () => {
    const { pieces } = feed(DOC, 4);
    expect(pieces.join("")).not.toContain("Cite a source");
  });

  it("ignores a key name that appears inside another field's value", () => {
    const doc = JSON.stringify({ feedback: 'say \\"aiMessage\\": "trap"', aiMessage: "real" });
    expect(feed(doc, 3).stream.value).toBe("real");
  });

  it("ignores the same key nested deeper than the top level", () => {
    const doc = '{"meta":{"aiMessage":"nested"},"aiMessage":"top"}';
    expect(feed(doc, 5).stream.value).toBe("top");
  });

  it("skips a prose preamble and a markdown fence before the object", () => {
    const doc = 'Here you go:\n```json\n{"aiMessage":"ok then"}\n```';
    expect(feed(doc, 2).stream.value).toBe("ok then");
  });

  it("holds an escape split across chunks until it is complete", () => {
    const s = createJsonFieldStream("aiMessage");
    expect(s.push('{"aiMessage":"a\\')).toBe("a");
    expect(s.push("u00")).toBe("");
    expect(s.push('e9b"}')).toBe("éb");
  });

  it("holds a surrogate pair split across \\u escapes", () => {
    const s = createJsonFieldStream("aiMessage");
    expect(s.push('{"aiMessage":"\\ud83c')).toBe("");
    expect(s.push('\\udf0d!"}')).toBe("🌍!");
  });

  it("emits nothing for a document without the field", () => {
    expect(feed('{"feedback":"only"}', 3).stream.value).toBe("");
  });
});
