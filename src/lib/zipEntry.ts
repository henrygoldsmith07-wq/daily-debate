// Minimal ZIP reader — extracts one entry from a GitHub Actions artifact
// download (item: consume the exact scheduler-witness artifact as the second
// delay witness). Artifacts arrive as ZIP archives; the repo is dependency-
// free by convention, so this reads the central directory directly instead
// of adding an unzip library.
//
// Correctness notes:
// - sizes/offsets are taken from the CENTRAL directory, never the local
//   header: entries written with bit 3 (data descriptor) carry zeros in the
//   local header, which would slice the payload at length 0.
// - only methods 0 (stored) and 8 (deflate) exist in practice; anything else
//   returns null rather than guessing.

import { inflateRawSync } from "node:zlib";

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/**
 * Return the bytes of the first entry whose name ends with `nameSuffix`,
 * or null when the archive is unreadable or the entry is absent.
 */
export function findZipEntry(buf: Buffer, nameSuffix: string): Buffer | null {
  try {
    // End-of-central-directory record: scan backwards for its signature.
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i -= 1) {
      if (buf.readUInt32LE(i) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return null;
    const totalEntries = buf.readUInt16LE(eocd + 10);
    const cdOffset = buf.readUInt32LE(eocd + 16);

    let cursor = cdOffset;
    for (let n = 0; n < totalEntries; n += 1) {
      if (cursor + 46 > buf.length || buf.readUInt32LE(cursor) !== CENTRAL_SIG) return null;
      const method = buf.readUInt16LE(cursor + 10);
      const compressedSize = buf.readUInt32LE(cursor + 20);
      const nameLen = buf.readUInt16LE(cursor + 28);
      const extraLen = buf.readUInt16LE(cursor + 30);
      const commentLen = buf.readUInt16LE(cursor + 32);
      const localOffset = buf.readUInt32LE(cursor + 42);
      const name = buf.toString("utf8", cursor + 46, cursor + 46 + nameLen);

      if (name.endsWith(nameSuffix)) {
        if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL_SIG) return null;
        const localNameLen = buf.readUInt16LE(localOffset + 26);
        const localExtraLen = buf.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + localNameLen + localExtraLen;
        const dataEnd = dataStart + compressedSize;
        if (dataEnd > buf.length) return null;
        const payload = buf.subarray(dataStart, dataEnd);
        if (method === 0) return Buffer.from(payload);
        if (method === 8) return inflateRawSync(payload);
        return null;
      }
      cursor += 46 + nameLen + extraLen + commentLen;
    }
    return null;
  } catch {
    return null;
  }
}
