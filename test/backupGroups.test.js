import test from "node:test";
import assert from "node:assert/strict";

import { groupBackupsByDay } from "../src/backupGroups.js";

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

test("groups backups into today, yesterday and earlier days, newest first", () => {
  const now = at(2026, 10, 7, 15);
  const groups = groupBackupsByDay(
    [
      { id: "old", createdAt: at(2026, 10, 3) },
      { id: "t1", createdAt: at(2026, 10, 7, 9) },
      { id: "y1", createdAt: at(2026, 10, 6, 23) },
      { id: "t2", createdAt: at(2026, 10, 7, 14) },
    ],
    now
  );
  assert.deepEqual(groups.map((g) => g.key), ["today", "yesterday", "date"]);
  assert.deepEqual(groups[0].items.map((b) => b.id), ["t2", "t1"]);
  assert.deepEqual(groups[1].items.map((b) => b.id), ["y1"]);
  assert.equal(groups[2].dayStart, new Date(2026, 9, 3).getTime());
});

test("an empty list gives no groups", () => {
  assert.deepEqual(groupBackupsByDay([], at(2026, 1, 1)), []);
});
