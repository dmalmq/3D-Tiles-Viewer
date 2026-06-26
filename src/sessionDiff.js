function buildingKey(b) {
  const link = b?.linkFilter?.value ?? "";
  return `${b?.name ?? ""}\0${link}`;
}

function venueMap(venues = []) {
  return new Map((venues ?? []).map((v) => [v.id, v]));
}

function indexBuildings(buildings = []) {
  const map = new Map();
  for (const b of buildings ?? []) {
    map.set(buildingKey(b), b);
  }
  return map;
}

export function diffSessions(before, after) {
  const changes = [];
  const beforeVenues = venueMap(before?.venues);
  const afterVenues = venueMap(after?.venues);

  for (const [id, venue] of afterVenues) {
    if (!beforeVenues.has(id)) {
      changes.push({ category: "venues", type: "added", id, name: venue.name });
    }
  }
  for (const [id, venue] of beforeVenues) {
    if (!afterVenues.has(id)) {
      changes.push({ category: "venues", type: "removed", id, name: venue.name });
    }
  }
  for (const [id, afterVenue] of afterVenues) {
    const beforeVenue = beforeVenues.get(id);
    if (!beforeVenue) continue;
    if (beforeVenue.name !== afterVenue.name) {
      changes.push({
        category: "venues",
        type: "renamed",
        id,
        from: beforeVenue.name,
        to: afterVenue.name,
      });
    }
    if ((beforeVenue.description ?? "") !== (afterVenue.description ?? "")) {
      changes.push({
        category: "venues",
        type: "descriptionChanged",
        id,
        name: afterVenue.name,
      });
    }
  }

  const beforeBuildings = indexBuildings(before?.buildings);
  const afterBuildings = indexBuildings(after?.buildings);

  for (const [key, b] of afterBuildings) {
    if (!beforeBuildings.has(key)) {
      changes.push({
        category: "buildings",
        type: "added",
        name: b.name,
        venueId: b.venueId ?? null,
      });
    }
  }
  for (const [key, b] of beforeBuildings) {
    if (!afterBuildings.has(key)) {
      changes.push({ category: "buildings", type: "removed", name: b.name });
    }
  }
  for (const [key, afterB] of afterBuildings) {
    const beforeB = beforeBuildings.get(key);
    if (!beforeB) continue;
    if ((beforeB.venueId ?? null) !== (afterB.venueId ?? null)) {
      changes.push({
        category: "buildings",
        type: "venueMoved",
        name: afterB.name,
        fromVenue: beforeB.venueId ?? null,
        toVenue: afterB.venueId ?? null,
      });
    }
    const beforeLevelCount = beforeB.levels?.length ?? 0;
    const afterLevelCount = afterB.levels?.length ?? 0;
    if (beforeLevelCount !== afterLevelCount) {
      changes.push({
        category: "levels",
        type: "changed",
        building: afterB.name,
        detail: `${beforeLevelCount} levels → ${afterLevelCount} levels`,
      });
    }
    const beforeLayers = new Set((beforeB.shapefileLayers ?? []).map((l) => l.name));
    const afterLayers = new Set((afterB.shapefileLayers ?? []).map((l) => l.name));
    for (const name of afterLayers) {
      if (!beforeLayers.has(name)) {
        changes.push({ category: "layers", type: "added", building: afterB.name, name });
      }
    }
    for (const name of beforeLayers) {
      if (!afterLayers.has(name)) {
        changes.push({ category: "layers", type: "removed", building: beforeB.name, name });
      }
    }
  }

  for (const field of ["imagery", "terrain"]) {
    if ((before?.[field] ?? null) !== (after?.[field] ?? null)) {
      changes.push({
        category: "settings",
        type: "changed",
        field,
        from: before?.[field] ?? null,
        to: after?.[field] ?? null,
      });
    }
  }

  if ((before?.plateauOverridesEnabled ?? true) !== (after?.plateauOverridesEnabled ?? true)) {
    changes.push({
      category: "settings",
      type: "changed",
      field: "plateauOverridesEnabled",
      from: before?.plateauOverridesEnabled ?? true,
      to: after?.plateauOverridesEnabled ?? true,
    });
  }

  return changes;
}