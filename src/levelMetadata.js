export function normalizeLevelRecords(levels = []) {
  return (levels ?? [])
    .filter(l => (l.levelKey ?? l.key) !== "unassigned")
    .map(l => ({
      name: l.levelName ?? l.name,
      key: l.levelKey ?? l.key ?? null,
      floor: Number(l.levelElevationMeters ?? l.floor ?? 0),
      minZMeters: Number.isFinite(Number(l.minZMeters)) ? Number(l.minZMeters) : null,
      maxZMeters: Number.isFinite(Number(l.maxZMeters)) ? Number(l.maxZMeters) : null,
      elementCount: Number.isFinite(Number(l.elementCount)) ? Number(l.elementCount) : null,
    }))
    .filter(l => l.name && Number.isFinite(l.floor))
    .sort((a, b) => a.floor - b.floor);
}

export function recordsToLevelsData(levels) {
  return {
    levels: normalizeLevelRecords(levels).map(l => ({
      levelName: l.name,
      levelKey: l.key,
      levelElevationMeters: l.floor,
      minZMeters: l.minZMeters,
      maxZMeters: l.maxZMeters,
      elementCount: l.elementCount,
    })),
  };
}

export function sourceLevelGroupsFromInspection(inspection) {
  const groups = new Map();
  if (!inspection?.groups) return groups;
  for (const [source, info] of inspection.groups) {
    const levels = normalizeLevelRecords(info.levels ?? []);
    if (levels.length > 0) groups.set(String(source), levels);
  }
  return groups;
}

export function levelsDataFromSourceLevelGroups(groups) {
  const merged = new Map();
  for (const levels of groups?.values?.() ?? []) {
    for (const level of normalizeLevelRecords(levels)) {
      const mergeKey = level.key ? `key:${level.key}` : `name:${level.name}`;
      const existing = merged.get(mergeKey);
      if (!existing) {
        merged.set(mergeKey, { ...level });
        continue;
      }
      if (existing.minZMeters == null || (level.minZMeters != null && level.minZMeters < existing.minZMeters)) {
        existing.minZMeters = level.minZMeters;
      }
      if (existing.maxZMeters == null || (level.maxZMeters != null && level.maxZMeters > existing.maxZMeters)) {
        existing.maxZMeters = level.maxZMeters;
      }
      if (level.elementCount != null) {
        existing.elementCount = (existing.elementCount ?? 0) + level.elementCount;
      }
    }
  }
  const levels = [...merged.values()].sort((a, b) => a.floor - b.floor);
  return levels.length ? recordsToLevelsData(levels) : null;
}

export function serializeSourceLevelGroups(groups) {
  if (!groups || groups.size === 0) return [];
  return [...groups.entries()].map(([source, levels]) => ({
    source,
    levels: normalizeLevelRecords(levels),
  }));
}

export function deserializeSourceLevelGroups(data) {
  const groups = new Map();
  for (const entry of data ?? []) {
    const source = entry?.source == null ? "" : String(entry.source);
    const levels = normalizeLevelRecords(entry?.levels ?? []);
    if (levels.length > 0) groups.set(source, levels);
  }
  return groups;
}
