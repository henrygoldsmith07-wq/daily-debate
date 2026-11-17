import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("speech lifecycle cleanup", () => {
  it("stops a live microphone when the recognition hook unmounts", () => {
    const s = source("src/components/useSpeechRecognition.ts");
    expect(s).toContain("useEffect");
    expect(s).toMatch(/useEffect\(\(\) => \(\) => \{ recognitionRef\.current\?\.stop\(\); \}, \[\]\)/);
  });

  it("cancels speech synthesis when the speaker unmounts", () => {
    const s = source("src/components/useSpeechSynthesis.ts");
    expect(s).toContain("useEffect");
    expect(s).toMatch(/useEffect\(\(\) => \(\) => \{[\s\S]{0,200}speechSynthesis\.cancel\(\)/);
  });

  it("stops dictation before a send remounts the composer", () => {
    const s = source("src/components/MessageComposer.tsx");
    expect(s).toMatch(/if \(listening\) \{ setText\(trimmed\); stop\(\); \}/);
  });
});
