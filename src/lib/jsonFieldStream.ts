// Incremental extraction of ONE top-level string field from streaming JSON.
//
// The opponent turn is a JSON object ({ feedback, aiMessage }) because the
// output is shape-validated before it is accepted (aiSchema.ts). Streaming it
// token-by-token therefore means reading the `aiMessage` string value out of a
// JSON document that is still arriving — without waiting for the closing brace
// and without ever showing the learner raw JSON or the private feedback field.
//
// This is a small character-level scanner, not a regex over the partial text:
//   - it tracks string/escape state, so a `"aiMessage"` that appears INSIDE
//     another field's value is never mistaken for the key;
//   - only depth-1 keys of the first object count, so nested objects cannot
//     shadow the field;
//   - leading prose or a ```json fence before the first `{` is skipped, the
//     same tolerance extractJson() applies to complete outputs;
//   - escapes split across chunks (`\` then `n`, or a `\uXXXX` / surrogate
//     pair cut mid-way) are held until complete, so a decoded prefix is always
//     a prefix of the final decoded value.
//
// The extracted text is for DISPLAY only. The authoritative value is still the
// fully parsed, schema-validated object.

export interface JsonFieldStream {
  /** Feed more raw model output; returns newly decoded field text ("" if none). */
  push(chunk: string): string;
  /** Everything decoded for the field so far. */
  readonly value: string;
  /** True once the field's closing quote has been read. */
  readonly complete: boolean;
}

type Mode =
  | "seek-object" // before the first `{`
  | "object" // inside the object, between tokens
  | "key" // inside a depth-1 key string
  | "after-key" // read a depth-1 key, expecting `:`
  | "value-start" // after `:`, expecting the value
  | "target" // inside the target field's string value
  | "skip-string" // inside any other string
  | "done";

export function createJsonFieldStream(field: string): JsonFieldStream {
  let mode: Mode = "seek-object";
  let depth = 0;
  let key = "";
  let lastKey = "";
  let escaping = false;
  let pendingEscape = ""; // raw escape sequence inside the target value
  let pendingHighSurrogate = "";
  let skipReturn: Mode = "object";
  let value = "";
  let complete = false;

  const decodeEscape = (seq: string): string | null => {
    // seq excludes the leading backslash.
    switch (seq[0]) {
      case "n": return "\n";
      case "t": return "\t";
      case "r": return "\r";
      case "b": return "\b";
      case "f": return "\f";
      case "/": return "/";
      case "\\": return "\\";
      case '"': return '"';
      case "u": {
        if (seq.length < 5) return null; // incomplete
        const code = Number.parseInt(seq.slice(1, 5), 16);
        return Number.isNaN(code) ? "" : String.fromCharCode(code);
      }
      default:
        return seq[0] ?? null;
    }
  };

  const emitChar = (ch: string, out: string[]) => {
    const code = ch.charCodeAt(0);
    if (ch.length === 1 && code >= 0xd800 && code <= 0xdbff) {
      // High surrogate: wait for its pair so a split emoji never renders as
      // a replacement character mid-stream.
      pendingHighSurrogate = ch;
      return;
    }
    if (pendingHighSurrogate) {
      out.push(pendingHighSurrogate);
      pendingHighSurrogate = "";
    }
    out.push(ch);
  };

  const push = (chunk: string): string => {
    const out: string[] = [];
    for (const ch of chunk) {
      switch (mode) {
        case "done":
          break;
        case "seek-object":
          if (ch === "{") {
            mode = "object";
            depth = 1;
          }
          break;
        case "object":
          if (ch === '"') {
            if (depth === 1 && (lastKey === "" || lastKey === ",")) {
              mode = "key";
              key = "";
            } else {
              skipReturn = "object";
              mode = "skip-string";
            }
          } else if (ch === "{" || ch === "[") {
            depth += 1;
          } else if (ch === "}" || ch === "]") {
            depth -= 1;
            if (depth === 0) mode = "done";
          } else if (ch === "," && depth === 1) {
            lastKey = ",";
          }
          break;
        case "key":
          if (escaping) {
            key += ch;
            escaping = false;
          } else if (ch === "\\") {
            escaping = true;
          } else if (ch === '"') {
            mode = "after-key";
          } else {
            key += ch;
          }
          break;
        case "after-key":
          if (ch === ":") mode = "value-start";
          break;
        case "value-start":
          if (/\s/.test(ch)) break;
          lastKey = "value";
          if (ch === '"') {
            mode = key === field && !complete ? "target" : "skip-string";
            skipReturn = "object";
          } else {
            mode = "object";
            if (ch === "{" || ch === "[") depth += 1;
          }
          break;
        case "skip-string":
          if (escaping) escaping = false;
          else if (ch === "\\") escaping = true;
          else if (ch === '"') mode = skipReturn;
          break;
        case "target":
          if (pendingEscape) {
            pendingEscape += ch;
            const decoded = decodeEscape(pendingEscape.slice(1));
            if (decoded === null) break;
            pendingEscape = "";
            if (decoded) emitChar(decoded, out);
          } else if (ch === "\\") {
            pendingEscape = "\\";
          } else if (ch === '"') {
            if (pendingHighSurrogate) {
              out.push(pendingHighSurrogate);
              pendingHighSurrogate = "";
            }
            complete = true;
            mode = "object";
          } else {
            emitChar(ch, out);
          }
          break;
      }
    }
    const added = out.join("");
    value += added;
    return added;
  };

  return {
    push,
    get value() {
      return value;
    },
    get complete() {
      return complete;
    },
  };
}
