import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { MESSAGES } from "../src/i18nStrings.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("en and ja define the same message keys", () => {
  const en = Object.keys(MESSAGES.en).sort();
  const ja = Object.keys(MESSAGES.ja).sort();
  const missingInJa = en.filter((k) => !(k in MESSAGES.ja));
  const missingInEn = ja.filter((k) => !(k in MESSAGES.en));
  assert.deepEqual(missingInJa, [], "keys present in en but missing in ja");
  assert.deepEqual(missingInEn, [], "keys present in ja but missing in en");
});

test("every data-i18n* key in the HTML shells exists in MESSAGES", () => {
  for (const file of ["index.html", "viewer.html"]) {
    const html = readFileSync(join(root, file), "utf8");
    const keys = [...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((m) => m[1]);
    const missing = [...new Set(keys)].filter((k) => !(k in MESSAGES.en));
    assert.deepEqual(missing, [], `keys referenced in ${file} but missing in MESSAGES.en`);
  }
});
