import test from "node:test";
import assert from "node:assert/strict";
import { createZip, crc32, toDosDateTime } from "../src/zipWriter.js";
import { readZipEntries, zipEntryMap } from "./zipRead.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

test("crc32 matches the known PKZIP value for '123456789'", () => {
  assert.equal(crc32(encoder.encode("123456789")), 0xcbf43926);
});

test("archive round-trips names, order and bytes", async () => {
  const zip = await createZip([
    { path: "tileset.json", data: encoder.encode('{"asset":{"version":"1.1"}}') },
    { path: "content/0/0/0.glb", data: new Uint8Array([1, 2, 3, 4, 5]) },
  ]);

  const entries = readZipEntries(zip);
  assert.deepEqual(entries.map((e) => e.name), ["tileset.json", "content/0/0/0.glb"]);
  assert.equal(decoder.decode(entries[0].data), '{"asset":{"version":"1.1"}}');
  assert.deepEqual([...entries[1].data], [1, 2, 3, 4, 5]);
  for (const entry of entries) {
    assert.equal(entry.crc, crc32(entry.data), `crc mismatch for ${entry.name}`);
    assert.equal(entry.uncompressedSize, entry.data.length);
  }
});

test("compressible text is deflated, incompressible bytes stay stored", async () => {
  const repetitive = encoder.encode("x".repeat(4096));
  const random = new Uint8Array(256);
  for (let i = 0; i < random.length; i++) random[i] = (i * 97 + 13) % 256;

  const zip = await createZip([
    { path: "big.json", data: repetitive },
    { path: "noise.bin", data: random },
  ]);
  const entries = zipEntryMap(zip);

  assert.equal(entries.get("big.json").method, 8);
  assert.ok(entries.get("big.json").compressedSize < repetitive.length);
  assert.equal(decoder.decode(entries.get("big.json").data), "x".repeat(4096));
  assert.equal(entries.get("noise.bin").method, 0);
  assert.deepEqual([...entries.get("noise.bin").data], [...random]);
});

test("compress:false stores every entry verbatim", async () => {
  const zip = await createZip([{ path: "a.txt", data: "hello" }], { compress: false });
  const [entry] = readZipEntries(zip);
  assert.equal(entry.method, 0);
  assert.equal(decoder.decode(entry.data), "hello");
});

test("empty archives are still valid and parse to zero entries", async () => {
  const zip = await createZip([]);
  assert.equal(zip.length, 22);
  assert.deepEqual(readZipEntries(zip), []);
});

test("paths are normalised and traversal is rejected", async () => {
  const zip = await createZip([{ path: "/nested\\dir/file.txt", data: "x" }]);
  assert.equal(readZipEntries(zip)[0].name, "nested/dir/file.txt");

  await assert.rejects(
    () => createZip([{ path: "../escape.txt", data: "x" }]),
    /escapes the archive/,
  );
  await assert.rejects(
    () => createZip([{ path: "a.txt", data: "1" }, { path: "a.txt", data: "2" }]),
    /Duplicate zip entry/,
  );
});

test("DOS timestamps clamp to the 1980 epoch", () => {
  assert.deepEqual(toDosDateTime(new Date(1970, 0, 1, 0, 0, 0)), { time: 0, date: (1 << 5) | 1 });
  const dos = toDosDateTime(new Date(2024, 4, 17, 13, 30, 20));
  assert.equal(dos.date, ((2024 - 1980) << 9) | (5 << 5) | 17);
  assert.equal(dos.time, (13 << 11) | (30 << 5) | 10);
});
