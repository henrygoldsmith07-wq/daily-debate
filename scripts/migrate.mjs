import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createExecutor } from "./lib/sql-executor.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(projectRoot, "database", "migrations");
const databaseUrl = process.env.DATABASE_URL?.trim();

function splitStatements(source) {
  const statements = [];
  let current = "";
  let quote = null;
  let dollarTag = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    current += character;

    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        current += next;
        index += 1;
        blockComment = false;
      }
      continue;
    }
    if (dollarTag) {
      if (source.startsWith(dollarTag, index)) {
        current += dollarTag.slice(1);
        index += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    }
    if (quote) {
      if (character === quote && next === quote) {
        current += next;
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "-" && next === "-") {
      current += next;
      index += 1;
      lineComment = true;
      continue;
    }
    if (character === "/" && next === "*") {
      current += next;
      index += 1;
      blockComment = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "$") {
      const match = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) {
        dollarTag = match[0];
        current += dollarTag.slice(1);
        index += dollarTag.length - 1;
        continue;
      }
    }
    if (character === ";") {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
    }
  }

  if (quote || dollarTag || blockComment) throw new Error("Unterminated SQL construct in migration.");
  if (current.trim()) statements.push(current.trim());
  return statements;
}

const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
if (process.argv.includes("--check")) {
  for (const name of files) {
    const migration = await readFile(path.join(migrationsDir, name), "utf8");
    console.log(`${name}: ${splitStatements(migration).length} statements`);
  }
  process.exit(0);
}
if (process.argv.includes("--status")) {
  // Read-only applied-vs-pending report used by CI and the deploy step.
  // Exit codes: 0 = ledger current, 1 = pending migrations remain (or the
  // ledger table is absent, i.e. the database was never migrated),
  // 2 = DATABASE_URL missing or database unreachable. NEVER migrates.
  if (!databaseUrl) {
    console.error("[db:status] DATABASE_URL is required.");
    process.exit(2);
  }
  const statusSql = await createExecutor(databaseUrl);
  let appliedNames;
  try {
    const rows = await statusSql("SELECT name FROM app_migrations ORDER BY name");
    appliedNames = rows.map((row) => String(row.name));
  } catch (error) {
    const message = String(error?.message ?? error);
    if (/relation .* does not exist|does not exist/i.test(message) && /app_migrations/i.test(message)) {
      console.log(`[db:status] applied: 0/${files.length} (no app_migrations ledger — never migrated)`);
      console.log(`[db:status] pending: ${files.length} (${files.join(", ")})`);
      process.exit(1);
    }
    console.error(`[db:status] database unreadable: ${message.slice(0, 160)}`);
    process.exit(2);
  }
  const appliedSet = new Set(appliedNames);
  const pending = files.filter((name) => !appliedSet.has(name));
  const ledgerOnly = appliedNames.filter((name) => !files.includes(name));
  console.log(`[db:status] applied: ${appliedNames.length}/${files.length} (last: ${appliedNames[appliedNames.length - 1] ?? "none"})`);
  if (ledgerOnly.length) console.log(`[db:status] ledger entries with no migration file: ${ledgerOnly.join(", ")}`);
  if (pending.length) {
    console.log(`[db:status] pending: ${pending.length} (${pending.join(", ")})`);
    process.exit(1);
  }
  console.log("[db:status] pending: none");
  process.exit(0);
}

if (!databaseUrl) throw new Error("DATABASE_URL is required to run migrations.");
const sql = await createExecutor(databaseUrl);

await sql(`CREATE TABLE IF NOT EXISTS app_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`);

for (const name of files) {
  const applied = await sql("SELECT 1 FROM app_migrations WHERE name = $1", [name]);
  if (applied.length) {
    console.log(`skip ${name}`);
    continue;
  }
  const migration = await readFile(path.join(migrationsDir, name), "utf8");
  for (const statement of splitStatements(migration)) await sql(statement);
  await sql("INSERT INTO app_migrations (name) VALUES ($1)", [name]);
  console.log(`applied ${name}`);
}
