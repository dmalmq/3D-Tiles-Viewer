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
