// Expand/contract migration policy (pure, unit-tested).
//
// Migrations must be ADDITIVE within one release: an old build must keep
// working against the new schema while it is still serving traffic (Vercel
// keeps the previous deployment live until the new one is promoted). A
// destructive change (DROP / RENAME / ALTER TYPE) is only allowed when the
// migration file carries an explicit opt-in marker:
//
//   -- destructive-ok: <reason>
//
// The marker is deliberately a comment the author must type: it cannot be
// satisfied by accident, and the reason is committed next to the SQL.
//
// This module is intentionally line-based and dependency-free: it reads the
// SQL text the same way a reviewer would, and it never executes anything.

/**
 * Marker regex: `destructive-ok: <reason>` in any comment style. The reason
 * capture stops at a block-comment terminator (asterisk-slash) or the end of
 * the line, so a one-line block comment records just the reason text.
 */
const MARKER_RE = /destructive-ok:\s*(\S[^\r\n]*?)(?:\s*\*\/|\s*$)/im;

/**
 * Destructive statement detectors. Each entry: [label, regex].
 *
 * - DROP of any schema object. `DROP DEFAULT` is excluded on purpose:
 *   dropping a column default loses no data and is a normal contract step.
 * - RENAME of tables, columns, indexes or types (breaking for any concurrent
 *   reader on the old name).
 * - ALTER TYPE in both spellings: the standalone `ALTER TYPE ...` statement
 *   and `ALTER TABLE ... ALTER COLUMN ... TYPE ...` (data conversion can
 *   rewrite or reject existing values).
 */
const DESTRUCTIVE_PATTERNS = [
  [
    "DROP",
    /\bDROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|FUNCTION|PROCEDURE|TRIGGER|VIEW|MATERIALIZED\s+VIEW|SCHEMA|TYPE|DOMAIN|SEQUENCE|POLICY|EXTENSION|FOREIGN\s+TABLE|PUBLICATION|SUBSCRIPTION)\b/i,
  ],
  ["RENAME", /\bRENAME\b/i],
  ["ALTER TYPE (standalone)", /\bALTER\s+TYPE\b/i],
  ["ALTER TYPE (column)", /\bALTER\s+TABLE\b[\s\S]{0,200}?\bALTER\s+COLUMN\b[\s\S]{0,200}?\bTYPE\b/i],
];

/**
 * Analyse one migration's SQL text under the expand/contract policy.
 * @param {string} source raw SQL of one migration file
 * @returns {{ destructive: boolean, markerReason: string | null,
 *   findings: Array<{rule: string, line: string}>, allowed: boolean }}
 */
export function checkMigrationPolicy(source) {
  const findings = [];
  for (const [rule, regex] of DESTRUCTIVE_PATTERNS) {
    const match = regex.exec(source);
    if (match) {
      const lineIndex = source.slice(0, match.index).lastIndexOf("\n") + 1;
      const line = (source.slice(lineIndex).split(/\r?\n/)[0] ?? "").trim();
      findings.push({ rule, line: line.slice(0, 160) });
    }
  }
  const marker = MARKER_RE.exec(source);
  const markerReason = marker ? marker[1].trim().slice(0, 200) : null;
  const destructive = findings.length > 0;
  return {
    destructive,
    markerReason,
    findings,
    allowed: !destructive || markerReason !== null,
  };
}

/**
 * Analyse a set of migration files; returns the policy violations.
 * @param {Array<{name: string, content: string}>} files
 * @returns {Array<{name: string, rule: string, line: string, hint: string}>}
 */
export function checkMigrationSet(files) {
  const violations = [];
  for (const file of files) {
    const result = checkMigrationPolicy(file.content);
    if (!result.destructive || result.allowed) continue;
    for (const finding of result.findings) {
      violations.push({
        name: file.name,
        rule: finding.rule,
        line: finding.line,
        hint: "add `-- destructive-ok: <reason>` to the migration, or make the change additive (expand now, contract in a later release)",
      });
    }
  }
  return violations;
}
