import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { findZipEntry } from "./zipEntry";

/**
 * Hand-rolled ZIP builder (stored or deflated entries) so the reader is
 * tested against the exact byte layout GitHub artifact downloads use —
 * including entries whose LOCAL header sizes are zeroed (data-descriptor
 * style), which is why the reader must trust the central directory.
 */
function buildZip(
  entries: Array<{ name: string; data: Buffer; method?: 0 | 8; zeroLocalSizes?: boolean }>,
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const method = entry.method ?? 0;
    const payload = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const nameBuf = Buffer.from(entry.name, "utf8");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(entry.zeroLocalSizes ? 0 : payload.length, 18);
    local.writeUInt32LE(entry.zeroLocalSizes ? 0 : entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(payload.length, 20); // central size: always truthful
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

describe("findZipEntry (GitHub artifact extraction)", () => {
  const json = JSON.stringify({ cronSlot: "0 20 * * *", schedulerDelayMs: 7_500_000 });

  it("extracts the topic-run-evidence JSON from a stored entry", () => {
    const zip = buildZip([
      { name: "topic-telemetry-fallback.json", data: Buffer.from("{}") },
      { name: "topic-run-evidence.json", data: Buffer.from(json) },
    ]);
    const found = findZipEntry(zip, "topic-run-evidence.json");
    expect(found).not.toBeNull();
    expect(JSON.parse(found!.toString("utf8"))).toEqual({
      cronSlot: "0 20 * * *",
      schedulerDelayMs: 7_500_000,
    });
  });

  it("extracts a deflated entry (method 8)", () => {
    const zip = buildZip([{ name: "topic-run-evidence.json", data: Buffer.from(json), method: 8 }]);
    const found = findZipEntry(zip, "topic-run-evidence.json");
    expect(found?.toString("utf8")).toBe(json);
  });

  it("uses central-directory sizes when local headers carry zeros (data descriptor)", () => {
    const zip = buildZip([
      { name: "topic-run-evidence.json", data: Buffer.from(json), zeroLocalSizes: true },
    ]);
    const found = findZipEntry(zip, "topic-run-evidence.json");
    expect(found?.toString("utf8")).toBe(json);
  });

  it("returns null for a missing entry, a non-zip buffer, or suffix mismatch", () => {
    const zip = buildZip([{ name: "other.json", data: Buffer.from("{}") }]);
    expect(findZipEntry(zip, "topic-run-evidence.json")).toBeNull();
    expect(findZipEntry(Buffer.from("not a zip at all"), "topic-run-evidence.json")).toBeNull();
  });
});
