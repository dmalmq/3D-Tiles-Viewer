export const PLATEAU_TYPE_ORDER = [
  'bldg',
  'tran',
  'brid',
  'veg',
  'frn',
  'luse',
  'wtr',
  'fld',
  'tnm',
  'urf',
  'dem',
];

export function normalizePlateauCatalog(data) {
  if (data != null && !Array.isArray(data) && typeof data !== "object") {
    console.warn(`normalizePlateauCatalog: expected object or array, got ${typeof data}`);
    return makeEmptyCatalog();
  }
  const latest = Array.isArray(data?.latest_datasets)
    ? data.latest_datasets.map(d => ({ ...d, _catalogSource: 'latest' }))
    : [];
  const datasetsRaw = Array.isArray(data)
    ? data
    : Array.isArray(data?.datasets)
      ? data.datasets
      : [];
  const datasets = datasetsRaw.map(d => ({ ...d, _catalogSource: d._catalogSource ?? 'dataset' }));
  const allDatasets = [...latest, ...datasets].filter(isPlateau3dTilesDataset);
  const areaOptions = buildPlateauAreaOptions(allDatasets);
  return makeCatalog(allDatasets, areaOptions);
}

function makeEmptyCatalog() {
  return makeCatalog([], []);
}

function makeCatalog(datasets, areaOptions) {
  // Plain data fields are kept for backward compatibility with code that
  // serializes the catalog or peeks at it for debugging. New callers should
  // prefer the methods below — the data fields may go away in a future change.
  const catalog = {
    datasets,
    areaOptions,
    listAreas() {
      return areaOptions;
    },
    findAreaByCode(code) {
      const normalized = normalizeCode(code);
      if (normalized == null) return null;
      return (
        areaOptions.find(
          (area) =>
            area.code === normalized || (area.aliases?.includes(normalized) ?? false),
        ) ?? null
      );
    },
    listChoicesFor(areas, options) {
      return getPlateauChoicesForAreas(catalog, areas, options);
    },
    listCategoryChoicesFor(areas, options) {
      return getPlateauCategoryChoicesForAreas(catalog, areas, options);
    },
  };
  return catalog;
}

export function getPlateauChoicesForArea(catalog, area, options = {}) {
  const rowsByType = new Map();
  for (const dataset of catalog?.datasets ?? []) {
    if (!datasetMatchesPlateauArea(dataset, area)) continue;
    const code = String(dataset.type_en).trim();
    if (!rowsByType.has(code)) rowsByType.set(code, []);
    rowsByType.get(code).push(dataset);
  }

  const choices = [];
  for (const [code, rows] of rowsByType) {
    const dataset = chooseBestPlateauDataset(rows);
    if (!dataset) continue;
    const hasNonTextured = rows.some(row => normalizeTextureValue(row.texture) !== true);
    const texture = normalizeTextureValue(dataset.texture);
    choices.push({
      code,
      label: getTypeLabel(code, dataset.type, options),
      dataset,
      url: getPlateauDatasetUrl(dataset),
      lod: normalizeLod(dataset.lod),
      lodRank: lodRank(dataset.lod),
      texture,
      texturedOnly: texture === true && !hasNonTextured,
    });
  }

  return choices.sort(comparePlateauChoice);
}

export function getPlateauChoicesForAreas(catalog, areas, options = {}) {
  const choices = [];
  for (const area of uniquePlateauAreas(areas)) {
    for (const choice of getPlateauChoicesForArea(catalog, area, options)) {
      choices.push({ ...choice, area });
    }
  }
  return choices.sort(comparePlateauChoice);
}

export function getPlateauCategoryChoicesForAreas(catalog, areas, options = {}) {
  const categoriesByCode = new Map();
  for (const choice of getPlateauChoicesForAreas(catalog, areas, options)) {
    let category = categoriesByCode.get(choice.code);
    if (!category) {
      category = {
        code: choice.code,
        label: choice.label,
        choices: [],
        areaCodes: new Set(),
        lods: new Set(),
        textures: new Set(),
        texturedOnly: true,
      };
      categoriesByCode.set(choice.code, category);
    }

    category.choices.push(choice);
    if (choice.area?.code) category.areaCodes.add(choice.area.code);
    if (choice.lod != null) category.lods.add(choice.lod);
    category.textures.add(String(choice.texture));
    category.texturedOnly &&= choice.texturedOnly;
  }

  return [...categoriesByCode.values()]
    .map(category => ({
      ...category,
      areaCount: category.areaCodes.size,
      lods: [...category.lods],
      textures: [...category.textures].map(value => value === 'true' ? true : value === 'false' ? false : null),
    }))
    .sort(comparePlateauChoice);
}

export function uniquePlateauAreas(areas) {
  const seen = new Set();
  const out = [];
  for (const area of areas ?? []) {
    if (!area?.code || seen.has(area.code)) continue;
    seen.add(area.code);
    out.push(area);
  }
  return out;
}

export function normalizeCode(value) {
  return value == null ? null : String(value).trim();
}

export function getPlateauDatasetUrl(dataset) {
  return dataset?.composite_url || dataset?.url;
}

function isPlateau3dTilesDataset(dataset) {
  const url = getPlateauDatasetUrl(dataset);
  return (
    dataset?.format === '3D Tiles' &&
    typeof dataset?.type_en === 'string' &&
    typeof url === 'string' &&
    url.includes('tileset.json') &&
    dataset.interior !== true
  );
}

function buildPlateauAreaOptions(datasets) {
  const areaMap = new Map();
  for (const dataset of datasets) {
    const code = normalizeCode(dataset.ward_code) || normalizeCode(dataset.city_code);
    if (!code) continue;

    const aliases = [
      normalizeCode(dataset.city_code),
      normalizeCode(dataset.ward_code),
    ].filter(Boolean);
    const existing = areaMap.get(code);
    if (existing) {
      for (const alias of aliases) {
        if (!existing.aliases.includes(alias)) existing.aliases.push(alias);
      }
      continue;
    }

    areaMap.set(code, {
      code,
      aliases,
      label: formatPlateauAreaLabel(dataset),
      pref: dataset.pref ?? '',
      city: dataset.city ?? '',
      ward: dataset.ward ?? '',
    });
  }

  return [...areaMap.values()].sort((a, b) => a.label.localeCompare(b.label, 'ja'));
}

function formatPlateauAreaLabel(dataset) {
  const parts = [dataset.pref, dataset.city, dataset.ward].filter(Boolean);
  return parts.length ? parts.join(' ') : normalizeCode(dataset.ward_code) || normalizeCode(dataset.city_code);
}

function datasetMatchesPlateauArea(dataset, area) {
  const codes = new Set([area?.code, ...(area?.aliases ?? [])].filter(Boolean));
  return codes.has(normalizeCode(dataset.city_code)) || codes.has(normalizeCode(dataset.ward_code));
}

function chooseBestPlateauDataset(rows) {
  return [...rows].sort(comparePlateauDatasetPreference)[0] ?? null;
}

function comparePlateauDatasetPreference(a, b) {
  return (
    texturePreferenceRank(b.texture) - texturePreferenceRank(a.texture) ||
    lodRank(b.lod) - lodRank(a.lod) ||
    catalogSourceRank(b) - catalogSourceRank(a) ||
    yearRank(b) - yearRank(a)
  );
}

function comparePlateauChoice(a, b) {
  const ai = PLATEAU_TYPE_ORDER.indexOf(a.code);
  const bi = PLATEAU_TYPE_ORDER.indexOf(b.code);
  const ar = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
  const br = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
  return ar - br ||
    String(a.label ?? '').localeCompare(String(b.label ?? ''), 'ja') ||
    String(a.area?.label ?? '').localeCompare(String(b.area?.label ?? ''), 'ja');
}

function texturePreferenceRank(value) {
  const texture = normalizeTextureValue(value);
  if (texture === false) return 2;
  if (texture == null) return 1;
  return 0;
}

function lodRank(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function catalogSourceRank(dataset) {
  if (dataset._catalogSource === 'latest') return 2;
  if (dataset.composite_url) return 1;
  return 0;
}

function yearRank(dataset) {
  if (dataset.year === 'latest') return Number.MAX_SAFE_INTEGER;
  const registration = Number(dataset.registration_year);
  const year = Number(dataset.year);
  if (Number.isFinite(registration)) return registration;
  if (Number.isFinite(year)) return year;
  return 0;
}

function getTypeLabel(code, fallback, options) {
  return options.getTypeLabel?.(code, fallback) ?? fallback ?? code;
}

function normalizeLod(value) {
  const text = value == null ? '' : String(value).trim();
  return text || null;
}

function normalizeTextureValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return null;
}
