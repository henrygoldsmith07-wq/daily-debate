import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const files = [
  "src/app/login/AuthForm.tsx",
  "src/app/login/forgot-password/ForgotPasswordForm.tsx",
  "src/components/AccountDataControls.tsx",
];

describe("account form input limits", () => {
  it("email and password inputs declare a maxLength", () => {
    const missing: string[] = [];
    for (const file of files) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      for (const m of source.matchAll(/<input\b[\s\S]*?\/>/g)) {
        if (/type="hidden"/.test(m[0])) continue;
        if (!/maxLength=/.test(m[0])) missing.push(file);
      }
    }
    expect(missing).toEqual([]);
  });
});
