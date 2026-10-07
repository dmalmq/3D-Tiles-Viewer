/**
 * The active model level is stored as an index into the sorted model-level
 * list. When that list is rebuilt (e.g. a new building adds a lower floor),
 * indices shift, so the selection is carried over by floor number instead.
 *
 * @param {{floorNumber: number}[]} prevLevels  list the index pointed into
 * @param {number} prevIndex                    -1 = "All floors"
 * @param {{floorNumber: number}[]} nextLevels  rebuilt list
 * @returns {number} index of the same floor in nextLevels, or -1
 */
export function remapActiveLevelIndex(prevLevels, prevIndex, nextLevels) {
  if (prevIndex < 0) return -1;
  const floorNumber = prevLevels[prevIndex]?.floorNumber;
  if (floorNumber == null) return -1;
  return nextLevels.findIndex((level) => level.floorNumber === floorNumber);
}

/**
 * Sorts a building's levels by elevation in place and returns the index the
 * previously active level now has (-1 stays -1), so a building's
 * activeLevelIndex keeps pointing at the same level after an insert or an
 * elevation edit.
 *
 * @param {{floor: number}[]} levels
 * @param {number} activeIndex
 * @returns {number}
 */
export function sortLevelsKeepingActive(levels, activeIndex) {
  const active = activeIndex >= 0 ? levels[activeIndex] : null;
  levels.sort((a, b) => a.floor - b.floor);
  return active ? levels.indexOf(active) : -1;
}
