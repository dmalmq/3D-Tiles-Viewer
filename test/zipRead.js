// Test-only ZIP reader. Parses the central directory produced by
// src/zipWriter.js so the unit tests can assert on real archive bytes instead
// of trusting the writer's own bookkeeping. Not a test file itself.

import { inflateRawSync } from "node:zlib";

const CENTRAL_HEADER_SIG = 0x02014b50;
const END_OF_CENTRAL_DIR_SIG = 0x06054b50;

export function readZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let endOffset = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === END_OF_CENTRAL_DIR_SIG) {
      endOffset = i;
      break;
    }
  }
  if (endOffset === -1) throw new Error("End of central directory not found");

  const count = view.getUint16(endOffset + 10, true);
  let offset = view.getUint32(endOffset + 16, true);

  const entries = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_HEADER_SIG) {
      throw new Error(`Bad central header at ${offset}`);
    }
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const stored = bytes.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? Uint8Array.from(stored) : new Uint8Array(inflateRawSync(stored));

    entries.push({ name, method, crc, compressedSize, uncompressedSize, data });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function zipEntryMap(bytes) {
  return new Map(readZipEntries(bytes).map((e) => [e.name, e]));
}
