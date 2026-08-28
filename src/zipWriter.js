// Minimal ZIP writer — no third-party dependency.
//
// Emits a standard (non-Zip64) archive with one local file header per entry
// plus a central directory. Entries are DEFLATE-compressed when the platform
// exposes `CompressionStream("deflate-raw")` (Chrome 80+, Node 18+) and stored
// uncompressed otherwise, so the same code path works in the browser export
// button and in `node --test`.
//
// Deliberate limits: no Zip64, no encryption, no directory entries. Offline
// tileset packs are well under the 4 GiB / 65535-entry ceiling.

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const END_OF_CENTRAL_DIR_SIG = 0x06054b50;
const VERSION_NEEDED = 20;
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const MAX_UINT32 = 0xffffffff;

let crcTable = null;

function getCrcTable() {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  crcTable = table;
  return table;
}

export function crc32(bytes) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** DOS date/time as used by the ZIP local + central headers. */
export function toDosDateTime(date) {
  const year = date.getFullYear();
  // The DOS epoch starts in 1980; clamp instead of emitting negative fields.
  const dosYear = Math.max(0, Math.min(127, year - 1980));
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f);
  const dosDate = (dosYear << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time: time & 0xffff, date: dosDate & 0xffff };
}

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new TextEncoder().encode(String(data ?? ""));
}

function normalizeEntryPath(path) {
  const cleaned = String(path ?? "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!cleaned) throw new Error("Zip entry path must not be empty");
  if (cleaned.split("/").some((part) => part === "..")) {
    throw new Error(`Zip entry path escapes the archive: ${path}`);
  }
  return cleaned;
}

function hasDeflateSupport() {
  return typeof globalThis.CompressionStream === "function";
}

async function deflateRaw(bytes) {
  const stream = new globalThis.CompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  void writer.write(bytes);
  void writer.close();
  const chunks = [];
  let total = 0;
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function encodeBody(bytes, compress) {
  if (!compress || bytes.length === 0 || !hasDeflateSupport()) {
    return { method: METHOD_STORE, body: bytes };
  }
  try {
    const deflated = await deflateRaw(bytes);
    // Storing is cheaper than a deflate stream that grew (already-compressed
    // glb/ktx2/jpeg payloads regularly do).
    if (deflated.length >= bytes.length) return { method: METHOD_STORE, body: bytes };
    return { method: METHOD_DEFLATE, body: deflated };
  } catch {
    return { method: METHOD_STORE, body: bytes };
  }
}

/**
 * Build a ZIP archive.
 *
 * @param {Array<{path: string, data: Uint8Array|ArrayBuffer|string}>} entries
 * @param {{compress?: boolean, date?: Date}} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function createZip(entries, { compress = true, date = new Date() } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  if (list.length > 0xffff) {
    throw new Error(`Too many zip entries: ${list.length}`);
  }
  const { time: dosTime, date: dosDate } = toDosDateTime(date);
  const encoder = new TextEncoder();

  const locals = [];
  const centrals = [];
  let offset = 0;
  const seen = new Set();

  for (const entry of list) {
    const path = normalizeEntryPath(entry?.path);
    if (seen.has(path)) throw new Error(`Duplicate zip entry: ${path}`);
    seen.add(path);

    const raw = toBytes(entry?.data);
    const nameBytes = encoder.encode(path);
    const { method, body } = await encodeBody(raw, compress);
    const crc = crc32(raw);

    if (offset > MAX_UINT32 || raw.length > MAX_UINT32) {
      throw new Error("Zip archive exceeds the 4 GiB non-Zip64 limit");
    }

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, LOCAL_HEADER_SIG, true);
    localView.setUint16(4, VERSION_NEEDED, true);
    localView.setUint16(6, FLAG_UTF8, true);
    localView.setUint16(8, method, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, body.length, true);
    localView.setUint32(22, raw.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, CENTRAL_HEADER_SIG, true);
    centralView.setUint16(4, VERSION_NEEDED, true);
    centralView.setUint16(6, VERSION_NEEDED, true);
    centralView.setUint16(8, FLAG_UTF8, true);
    centralView.setUint16(10, method, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, body.length, true);
    centralView.setUint32(24, raw.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
  }

  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, END_OF_CENTRAL_DIR_SIG, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, centrals.length, true);
  endView.setUint16(10, centrals.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  const totalSize = offset + centralSize + end.length;
  const out = new Uint8Array(totalSize);
  let cursor = 0;
  for (const chunk of locals) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  for (const chunk of centrals) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  out.set(end, cursor);
  return out;
}
