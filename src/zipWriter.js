/**
 * Minimal store-only ZIP writer. Tiles and images are already compressed, so
 * deflate would buy little and cost a dependency.
 *
 * Entry data stays as a Blob/File and is streamed, never held whole in memory:
 * a real venue's tiles are far larger than one ArrayBuffer allocation.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/** ZIP32 keeps every offset in a uint32, so the archive cannot pass 4 GiB. */
const MAX_ARCHIVE_BYTES = 0xffffffff;

function updateCrc(crc, bytes) {
  let next = crc;
  for (let i = 0; i < bytes.length; i++) {
    next = CRC_TABLE[(next ^ bytes[i]) & 0xff] ^ (next >>> 8);
  }
  return next;
}

export function crc32(bytes) {
  return (updateCrc(0xffffffff, bytes) ^ 0xffffffff) >>> 0;
}

function toBlob(data) {
  if (data instanceof Blob) return data;
  if (typeof data === "string") return new Blob([data]);
  if (data instanceof Uint8Array || data instanceof ArrayBuffer) return new Blob([data]);
  throw new Error("Zip entry data must be a string, Uint8Array, ArrayBuffer, or Blob.");
}

async function crc32OfBlob(blob) {
  const reader = blob.stream().getReader();
  let crc = 0xffffffff;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    crc = updateCrc(crc, value);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function localHeader(name, crc, size) {
  const header = new Uint8Array(30 + name.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true); // UTF-8 names
  view.setUint16(8, 0, true); // stored
  view.setUint16(10, 0, true); // time
  view.setUint16(12, 0x0021, true); // date: 1980-01-01
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, name.length, true);
  view.setUint16(28, 0, true);
  header.set(name, 30);
  return header;
}

function centralHeader(name, crc, size, offset) {
  const header = new Uint8Array(46 + name.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint16(14, 0x0021, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, name.length, true);
  view.setUint32(42, offset, true);
  header.set(name, 46);
  return header;
}

/**
 * @param {{ path: string, data: string | Uint8Array | ArrayBuffer | Blob }[]} entries
 * @returns {Promise<Blob>} the archive, backed by the browser rather than the heap
 */
export async function createZip(entries) {
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const blob = toBlob(entry.data);
    const name = encoder.encode(entry.path);
    const size = blob.size;
    const crc = await crc32OfBlob(blob);

    parts.push(localHeader(name, crc, size), blob);
    central.push(centralHeader(name, crc, size, offset));
    offset += 30 + name.length + size;
    if (offset > MAX_ARCHIVE_BYTES) {
      throw new Error(
        "Bundle is larger than 4 GB, which this zip format cannot address. Export fewer buildings.",
      );
    }
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
