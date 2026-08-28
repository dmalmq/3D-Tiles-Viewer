/**
 * Merge async terrain-init results into the live providers object.
 * Never replace the object, and never overwrite a world-terrain provider
 * that Apply already installed with a later null/stale init result.
 */
export function mergeTerrainProviders(target, incoming) {
  if (!target) {
    return incoming ?? { worldTerrainProvider: null, plateauTerrainProvider: null };
  }
  if (!incoming || incoming === target) return target;
  if (incoming.plateauTerrainProvider != null) {
    target.plateauTerrainProvider = incoming.plateauTerrainProvider;
  }
  if (target.worldTerrainProvider == null && incoming.worldTerrainProvider != null) {
    target.worldTerrainProvider = incoming.worldTerrainProvider;
  }
  return target;
}
