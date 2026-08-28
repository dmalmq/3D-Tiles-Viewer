import test from "node:test";
import assert from "node:assert/strict";

import { createZip, crc32 } from "../src/zipWriter.js";

async function bytesOf(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

function readUint32(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function readUint16(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

/** Fails loudly if the writer tries to pull a whole entry into memory. */
class StreamOnlyBlob extends Blob {
  arrayBuffer() {
    throw new Error("arrayBuffer() must not be called on a zip entry");
  }
  text() {
    throw new Error("text() must not be called on a zip entry");
  }
}

test("crc32 matches the known checksum for a fixed input", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("createZip writes local headers, a central directory, and the end record", async () => {
  const zip = await bytesOf(
    await createZip([
      { path: "venue.json", data: '{"format":"venue-web"}' },
      { path: "tiles/main/tileset.json", data: new Uint8Array([1, 2, 3, 4]) },
    ]),
  );

  assert.equal(readUint32(zip, 0), 0x04034b50, "first entry starts with a local header");

  const end = zip.length - 22;
  assert.equal(readUint32(zip, end), 0x06054b50, "archive ends with the EOCD record");
  assert.equal(readUint16(zip, end + 8), 2, "EOCD counts both entries");

  const centralSize = readUint32(zip, end + 12);
  const centralOffset = readUint32(zip, end + 16);
  assert.equal(centralOffset + centralSize, end, "central directory sits between data and EOCD");
  assert.equal(readUint32(zip, centralOffset), 0x02014b50, "central directory header signature");
});

test("a stored entry round-trips byte for byte", async () => {
  const payload = '{"levels":["1F","2F"]}';
  const zip = await bytesOf(await createZip([{ path: "venue.json", data: payload }]));

  const nameLength = readUint16(zip, 26);
  const dataStart = 30 + nameLength + readUint16(zip, 28);
  const stored = zip.subarray(dataStart, dataStart + readUint32(zip, 18));

  assert.equal(new TextDecoder().decode(stored), payload);
  assert.equal(readUint32(zip, 14), crc32(new TextEncoder().encode(payload)));
  assert.equal(readUint16(zip, 8), 0, "entries are stored, not deflated");
  assert.equal(new TextDecoder().decode(zip.subarray(30, 30 + nameLength)), "venue.json");
});

test("createZip keeps UTF-8 paths and flags them", async () => {
  const zip = await bytesOf(await createZip([{ path: "layers/縦動線.geojson", data: "{}" }]));
  const nameLength = readUint16(zip, 26);
  assert.equal(
    new TextDecoder().decode(zip.subarray(30, 30 + nameLength)),
    "layers/縦動線.geojson",
  );
  assert.equal(readUint16(zip, 6) & 0x0800, 0x0800, "UTF-8 name flag is set");
});

test("entries are streamed, never buffered whole", async () => {
  const payload = new Uint8Array(1024 * 512).fill(7);
  const entry = new StreamOnlyBlob([payload]);

  const zip = await bytesOf(
    await createZip([
      { path: "tiles/main/content.glb", data: entry },
      { path: "venue.json", data: "{}" },
    ]),
  );

  assert.equal(readUint32(zip, 18), payload.length, "the streamed size is recorded");
  assert.equal(readUint32(zip, 14), crc32(payload), "the streamed CRC matches");
});

test("createZip rejects data it cannot store", async () => {
  await assert.rejects(
    () => createZip([{ path: "bad", data: { nope: true } }]),
    /must be a string/,
  );
});
