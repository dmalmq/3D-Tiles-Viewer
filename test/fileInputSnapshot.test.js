import test from "node:test";
import assert from "node:assert/strict";

import { snapshotAndClearFileInput } from "../src/fileInputSnapshot.js";

function makeLiveClearingInput(files) {
  let currentFiles = files;
  return {
    get files() {
      return currentFiles;
    },
    set value(value) {
      if (value === "") currentFiles = [];
    },
  };
}

test("snapshots file input files before clearing the live selection", () => {
  const selected = [{ name: "JRShinjukuSta.gdb/a00000001.gdbtable" }];
  const input = makeLiveClearingInput(selected);

  const files = snapshotAndClearFileInput(input);

  assert.deepEqual(files, selected);
  assert.equal(input.files.length, 0);
});

