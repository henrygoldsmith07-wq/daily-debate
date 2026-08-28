import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

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

if (!databaseUrl) throw new Error("DATABASE_URL is required to run migrations.");
const sql = neon(databaseUrl);

await sql.query(`CREATE TABLE IF NOT EXISTS app_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`);

for (const name of files) {
  const applied = await sql.query("SELECT 1 FROM app_migrations WHERE name = $1", [name]);
  if (applied.length) {
    console.log(`skip ${name}`);
    continue;
  }
  const migration = await readFile(path.join(migrationsDir, name), "utf8");
  for (const statement of splitStatements(migration)) await sql.query(statement);
  await sql.query("INSERT INTO app_migrations (name) VALUES ($1)", [name]);
  console.log(`applied ${name}`);
}
