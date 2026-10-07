/**
 * Groups session backups (newest first) by calendar day for the Backups
 * drawer: "today", "yesterday", then one group per earlier date.
 */

function dayStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {{createdAt: number}[]} backups
 * @param {number} now  timestamp used as "today"
 * @returns {{ key: "today"|"yesterday"|"date", dayStart: number, items: object[] }[]}
 */
export function groupBackupsByDay(backups, now = Date.now()) {
  const today = dayStart(now);
  const groups = [];
  const byDay = new Map();
  const sorted = [...backups].sort((a, b) => b.createdAt - a.createdAt);
  for (const entry of sorted) {
    const start = dayStart(entry.createdAt);
    let group = byDay.get(start);
    if (!group) {
      // Compare calendar days, not 24h windows, so DST shifts don't matter.
      const daysAgo = Math.round((today - start) / DAY_MS);
      const key = daysAgo <= 0 ? "today" : daysAgo === 1 ? "yesterday" : "date";
      group = { key, dayStart: start, items: [] };
      byDay.set(start, group);
      groups.push(group);
    }
    group.items.push(entry);
  }
  return groups;
}
