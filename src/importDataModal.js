import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Cartesian3,
  Math as CesiumMath,
  Color,
  GeoJsonDataSource,
  HeightReference,
  JulianDate,
} from 'cesium';
import { t, applyTranslationsToDom } from './i18n.js';
import {
  normalizeCode,
  normalizePlateauCatalog,
  uniquePlateauAreas,
} from './plateauCatalog.js';
import { resolveAutoPlateauAreaSelection } from './plateauAreaSelection.js';

const PLATEAU_CATALOG_API = 'https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets';
const GSI_REVERSE_GEOCODER_API = 'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress';

const DEFAULT_PLATEAU_TYPES = ['bldg'];
const PLATEAU_TYPE_LABEL_KEYS = {
  bldg: 'plateau.feature.bldg',
  tran: 'plateau.feature.tran',
  brid: 'plateau.feature.brid',
  veg: 'plateau.feature.veg',
  frn: 'plateau.feature.frn',
  luse: 'plateau.feature.luse',
  wtr: 'plateau.feature.wtr',
  fld: 'plateau.feature.fld',
  tnm: 'plateau.feature.tnm',
  urf: 'plateau.feature.urf',
  dem: 'plateau.feature.dem',
};

const SOURCES = [
  {
    id: 'osm-trees',
    labelKey: 'sources.osmTrees.label',
    categoryKey: 'sources.cat.vegetation',
    areaCapKm2: 25,
    descKey: 'sources.osmTrees.desc',
    learnMoreUrl: 'https://wiki.openstreetmap.org/wiki/Tag:natural%3Dtree',
  },
  {
    id: 'plateau-3dtiles',
    labelKey: 'sources.plateau.label',
    categoryKey: 'sources.cat.cityModel',
    areaCapKm2: null,
    descKey: 'sources.plateau.desc',
    learnMoreUrl: 'https://docs.plateauview.mlit.go.jp/quickstart/',
  },
  {
    id: 'osm-buildings',
    labelKey: 'sources.osmBuildings.label',
    categoryKey: 'sources.cat.buildings',
    areaCapKm2: 10,
    descKey: 'sources.osmBuildings.desc',
    learnMoreUrl: 'https://wiki.openstreetmap.org/wiki/Buildings',
  },
];

let plateauCatalogPromise = null;

export function openImportDataModal(viewer, loadTilesetFromUrl, onLayerAdded, options = {}) {
  let currentBounds = null;
  let selectedSourceId = SOURCES[0].id;
  let selectedPlateauAreas = [];
  let selectedPlateauAreaSource = null;
  let plateauAreaSelectionMode = 'auto';
  let plateauAreaDetectionAttempted = false;
  let plateauAreaDetectionSeq = 0;
  let selectedPlateauTypes = new Set(DEFAULT_PLATEAU_TYPES);
  let plateauCatalog = null;
  let plateauCatalogError = null;
  let leafletMap = null;
  let plateauAreaInput = null;
  let plateauAreaDatalist = null;
  let plateauTypeList = null;
  let plateauStatus = null;
  let closed = false;

  // -- Overlay + modal --
  const overlay = document.createElement('div');
  overlay.id = 'importModalOverlay';

  const modal = document.createElement('div');
  modal.id = 'importModal';
  overlay.appendChild(modal);

  // Header
  const header = document.createElement('div');
  header.className = 'import-modal-header';
  const titleEl = document.createElement('span');
  titleEl.textContent = t('modal.title');
  const closeBtn = document.createElement('button');
  closeBtn.className = 'import-modal-close';
  closeBtn.textContent = '×';
  closeBtn.title = t('modal.close');
  closeBtn.addEventListener('click', closeModal);
  header.appendChild(titleEl);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // Source list
  const sourceList = document.createElement('div');
  sourceList.className = 'import-source-list';
  const addBtns = {};
  const areaSpans = {};

  for (const src of SOURCES) {
    const row = document.createElement('div');
    row.className = 'import-source-row' + (src.id === selectedSourceId ? ' selected' : '');
    row.dataset.sourceId = src.id;

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'importSource';
    radio.value = src.id;
    radio.checked = src.id === selectedSourceId;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'import-source-name';
    nameSpan.textContent = t(src.labelKey);

    const catSpan = document.createElement('span');
    catSpan.className = 'import-source-cat';
    catSpan.textContent = t(src.categoryKey);

    const areaSpan = document.createElement('span');
    areaSpan.className = 'import-source-area';
    areaSpan.textContent = src.areaCapKm2 === null ? t('modal.areaUnknown') : t('modal.areaPending');
    areaSpans[src.id] = areaSpan;

    const badge = document.createElement('span');
    badge.className = 'import-source-badge';
    badge.textContent = t('modal.free');

    const addBtn = document.createElement('button');
    addBtn.className = 'import-source-add-btn';
    addBtn.textContent = t('modal.add');
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleAdd(src);
    });
    addBtns[src.id] = addBtn;

    row.appendChild(radio);
    row.appendChild(nameSpan);
    row.appendChild(catSpan);
    row.appendChild(areaSpan);
    row.appendChild(badge);
    row.appendChild(addBtn);
    row.addEventListener('click', () => selectSource(src.id));
    sourceList.appendChild(row);
  }
  modal.appendChild(sourceList);

  // Progress bar (shown only during batched loads)
  const progressEl = document.createElement('progress');
  progressEl.className = 'progress-bar';
  progressEl.hidden = true;
  modal.appendChild(progressEl);

  // Status line
  const statusLine = document.createElement('p');
  statusLine.className = 'import-status-line';
  modal.appendChild(statusLine);

  // Body: description pane + map pane
  const body = document.createElement('div');
  body.className = 'import-modal-body';

  const descPane = document.createElement('div');
  descPane.className = 'import-desc-pane';

  const mapPane = document.createElement('div');
  mapPane.className = 'import-map-pane';

  body.appendChild(descPane);
  body.appendChild(mapPane);
  modal.appendChild(body);

  // -- Source selection --
  function selectSource(id) {
    selectedSourceId = id;
    for (const row of sourceList.querySelectorAll('.import-source-row')) {
      const active = row.dataset.sourceId === id;
      row.classList.toggle('selected', active);
      row.querySelector('input[type="radio"]').checked = active;
    }
    updateDescPane(SOURCES.find(s => s.id === id));
  }

  function updateDescPane(src) {
    descPane.innerHTML = '';
    plateauAreaInput = null;
    plateauAreaDatalist = null;
    plateauTypeList = null;
    plateauStatus = null;

    const desc = document.createElement('p');
    desc.textContent = t(src.descKey);
    descPane.appendChild(desc);

    const link = document.createElement('a');
    link.href = src.learnMoreUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = t('modal.learnMore');
    descPane.appendChild(link);

    if (src.id === 'plateau-3dtiles') {
      buildPlateauControls();
      renderPlateauControls();
    }
  }

  function buildPlateauControls() {
    const areaRow = document.createElement('div');
    areaRow.className = 'import-plateau-option-row';

    const areaLabel = document.createElement('span');
    areaLabel.className = 'import-plateau-option-label';
    areaLabel.textContent = t('plateau.areaLabel');

    plateauAreaInput = document.createElement('input');
    plateauAreaInput.className = 'import-plateau-select';
    plateauAreaInput.type = 'text';
    plateauAreaInput.setAttribute('list', 'plateauAreaOptions');
    plateauAreaInput.placeholder = t('plateau.areaPlaceholder');
    plateauAreaInput.addEventListener('change', () => {
      const value = plateauAreaInput.value.trim();
      if (!value) {
        plateauAreaSelectionMode = 'auto';
        plateauAreaDetectionAttempted = false;
        selectedPlateauAreas = [];
        selectedPlateauAreaSource = null;
        detectPlateauAreasFromCurrentMap();
        renderPlateauControls();
        updateAreaLabels(currentBounds);
        return;
      }

      const area = findPlateauAreaByInput(value);
      if (area) {
        plateauAreaSelectionMode = 'manual';
        selectedPlateauAreas = [area];
        selectedPlateauAreaSource = 'manual';
        syncPlateauTypeSelection();
        renderPlateauControls();
        updateAreaLabels(currentBounds);
      } else if (plateauStatus) {
        plateauStatus.textContent = t('plateau.areaNotFound');
      }
    });

    plateauAreaDatalist = document.createElement('datalist');
    plateauAreaDatalist.id = 'plateauAreaOptions';

    areaRow.appendChild(areaLabel);
    areaRow.appendChild(plateauAreaInput);
    areaRow.appendChild(plateauAreaDatalist);
    descPane.appendChild(areaRow);

    plateauStatus = document.createElement('p');
    plateauStatus.className = 'import-plateau-status';
    descPane.appendChild(plateauStatus);

    const typeTitle = document.createElement('div');
    typeTitle.className = 'import-plateau-type-title';
    typeTitle.textContent = t('plateau.categoriesLabel');
    descPane.appendChild(typeTitle);

    plateauTypeList = document.createElement('div');
    plateauTypeList.className = 'import-plateau-category-list';
    descPane.appendChild(plateauTypeList);
  }

  function renderPlateauControls() {
    if (!plateauAreaInput || !plateauTypeList || !plateauStatus) return;

    plateauAreaInput.value = selectedPlateauAreas.length === 1
      ? formatPlateauAreaInput(selectedPlateauAreas[0])
      : '';
    populatePlateauAreaDatalist();

    if (plateauCatalogError) {
      plateauStatus.textContent = t('plateau.catalogError', { message: plateauCatalogError.message });
      renderPlateauEmptyTypeList(t('plateau.noCategories'));
      return;
    }

    if (!plateauCatalog) {
      plateauStatus.textContent = t('plateau.catalogLoading');
      renderPlateauEmptyTypeList(t('plateau.noCategories'));
      return;
    }

    if (selectedPlateauAreas.length === 0) {
      plateauStatus.textContent = plateauAreaDetectionAttempted && plateauAreaSelectionMode === 'auto'
        ? t('plateau.areaNotDetected')
        : t('plateau.areaRequired');
      renderPlateauEmptyTypeList(t('plateau.noCategories'));
      return;
    }

    const choices = plateauCatalog.listCategoryChoicesFor(selectedPlateauAreas, {
      getTypeLabel: getPlateauTypeLabel,
    });
    syncPlateauTypeSelection(choices);
    const sourceLabel = getPlateauAreaSourceLabel(selectedPlateauAreaSource);
    plateauStatus.textContent = t('plateau.areaStatus', {
      area: formatPlateauAreasLabel(selectedPlateauAreas),
      source: sourceLabel,
    });

    plateauTypeList.innerHTML = '';
    if (choices.length === 0) {
      renderPlateauEmptyTypeList(t('plateau.noCategoriesForArea'));
      return;
    }

    for (const choice of choices) {
      const row = document.createElement('label');
      row.className = 'import-plateau-category-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedPlateauTypes.has(choice.code);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selectedPlateauTypes.add(choice.code);
        else selectedPlateauTypes.delete(choice.code);
      });

      const textWrap = document.createElement('span');
      textWrap.className = 'import-plateau-category-text';

      const name = document.createElement('span');
      name.className = 'import-plateau-category-name';
      name.textContent = choice.label;

      const meta = document.createElement('span');
      meta.className = 'import-plateau-category-meta';
      meta.textContent = formatPlateauChoiceMeta(choice);

      textWrap.appendChild(name);
      textWrap.appendChild(meta);
      row.appendChild(checkbox);
      row.appendChild(textWrap);
      plateauTypeList.appendChild(row);
    }
  }

  function renderPlateauEmptyTypeList(message) {
    plateauTypeList.innerHTML = '';
    const empty = document.createElement('p');
    empty.className = 'empty-msg';
    empty.textContent = message;
    plateauTypeList.appendChild(empty);
  }

  function populatePlateauAreaDatalist() {
    if (!plateauAreaDatalist) return;
    plateauAreaDatalist.innerHTML = '';
    for (const area of plateauCatalog?.listAreas() ?? []) {
      const opt = document.createElement('option');
      opt.value = formatPlateauAreaInput(area);
      plateauAreaDatalist.appendChild(opt);
    }
  }

  function findPlateauAreaByInput(value) {
    const trimmed = value.trim();
    if (!trimmed || !plateauCatalog) return null;
    // First try plain code / alias match through the catalog's lookup.
    const byCode = plateauCatalog.findAreaByCode(trimmed);
    if (byCode) return byCode;
    // Fall back to label-based match (the input was the formatted area label).
    return plateauCatalog.listAreas().find(area =>
      formatPlateauAreaInput(area) === trimmed
    ) ?? null;
  }

  function syncPlateauTypeSelection(choices = null) {
    if (!choices && plateauCatalog && selectedPlateauAreas.length > 0) {
      choices = plateauCatalog.listCategoryChoicesFor(selectedPlateauAreas, {
        getTypeLabel: getPlateauTypeLabel,
      });
    }
    if (!choices) return;

    const available = new Set(choices.map(choice => choice.code));
    for (const code of [...selectedPlateauTypes]) {
      if (!available.has(code)) selectedPlateauTypes.delete(code);
    }
    if (selectedPlateauTypes.size === 0 && available.has('bldg')) {
      selectedPlateauTypes.add('bldg');
    }
  }

  // -- Area labels --
  function updateAreaLabels(bounds) {
    currentBounds = bounds;
    for (const src of SOURCES) {
      if (src.id === 'plateau-3dtiles') {
        areaSpans[src.id].textContent = selectedPlateauAreas.length
          ? formatPlateauAreasLabel(selectedPlateauAreas)
          : t('modal.areaUnknown');
      } else if (src.areaCapKm2 !== null && bounds) {
        areaSpans[src.id].textContent = t('modal.areaKm2', { area: bboxAreaKm2(bounds).toFixed(2) });
      }
    }
  }

  // -- Mount + init Leaflet --
  document.body.appendChild(overlay);
  applyTranslationsToDom(overlay);
  updateDescPane(SOURCES[0]);
  initializePlateauCatalogAndArea();

  setTimeout(() => {
    if (closed || !overlay.isConnected) return;
    const cam = viewer.camera.positionCartographic;
    const lat = CesiumMath.toDegrees(cam.latitude);
    const lng = CesiumMath.toDegrees(cam.longitude);
    const alt = cam.height;
    const zoom = Math.max(4, Math.min(17, Math.round(14 - Math.log2(alt / 500))));

    leafletMap = L.map(mapPane, { zoomControl: true }).setView([lat, lng], zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(leafletMap);

    let bboxRect = L.rectangle(leafletMap.getBounds(), {
      color: '#4da6ff',
      weight: 2,
      fillOpacity: 0.08,
      interactive: false,
    }).addTo(leafletMap);

    const onMapChange = () => {
      leafletMap.removeLayer(bboxRect);
      bboxRect = L.rectangle(leafletMap.getBounds(), {
        color: '#4da6ff',
        weight: 2,
        fillOpacity: 0.08,
        interactive: false,
      }).addTo(leafletMap);
      updateAreaLabels(leafletMap.getBounds());
      detectPlateauAreasFromCurrentMap();
    };

    leafletMap.on('moveend zoomend', onMapChange);
    updateAreaLabels(leafletMap.getBounds());
    detectPlateauAreasFromCurrentMap();
    leafletMap.invalidateSize();
  }, 0);

  async function initializePlateauCatalogAndArea() {
    try {
      plateauCatalog = await fetchPlateauCatalog();
      if (closed || !overlay.isConnected) return;
      const position = getPreferredPlateauPosition();
      const detectedArea = position
        ? await detectPlateauAreaFromPosition(position, plateauCatalog)
        : null;
      if (closed || !overlay.isConnected) return;
      if (detectedArea && selectedPlateauAreas.length === 0 && plateauAreaSelectionMode === 'auto') {
        selectedPlateauAreas = [detectedArea.area];
        selectedPlateauAreaSource = detectedArea.source;
      } else if (!detectedArea && selectedPlateauAreas.length === 0 && plateauAreaSelectionMode === 'auto') {
        plateauAreaDetectionAttempted = true;
      }
    } catch (e) {
      plateauCatalogError = e instanceof Error ? e : new Error(String(e));
    }
    syncPlateauTypeSelection();
    updateAreaLabels(currentBounds);
    renderPlateauControls();
    if (leafletMap && plateauAreaSelectionMode === 'auto') detectPlateauAreasFromCurrentMap();
  }

  async function detectPlateauAreasFromCurrentMap() {
    if (!plateauCatalog || plateauAreaSelectionMode === 'manual') return;

    const positions = leafletMap
      ? samplePlateauPositionsForBounds(leafletMap.getBounds())
      : [getPreferredPlateauPosition()].filter(Boolean);
    if (positions.length === 0) return;

    const seq = ++plateauAreaDetectionSeq;
    if (plateauStatus && selectedPlateauAreas.length === 0) {
      plateauStatus.textContent = t('plateau.areaDetecting');
    }

    try {
      const detected = await detectPlateauAreasFromPositions(positions, plateauCatalog);
      if (closed || !overlay.isConnected || seq !== plateauAreaDetectionSeq || plateauAreaSelectionMode === 'manual') return;

      const selection = resolveAutoPlateauAreaSelection({
        selectionMode: plateauAreaSelectionMode,
        currentAreas: selectedPlateauAreas,
        currentSource: selectedPlateauAreaSource,
        detected,
        fallbackSource: leafletMap ? 'map' : detected[0]?.source,
      });
      selectedPlateauAreas = selection.areas;
      selectedPlateauAreaSource = selection.source;
      plateauAreaDetectionAttempted = true;
      syncPlateauTypeSelection();
      updateAreaLabels(currentBounds);
      renderPlateauControls();
    } catch (e) {
      console.warn('PLATEAU area detection failed:', e);
    }
  }

  function getPreferredPlateauPosition() {
    const preferred = options.getPreferredImportPosition?.();
    if (isFiniteLatLng(preferred)) {
      return {
        lat: preferred.lat,
        lng: preferred.lng,
        source: preferred.source ?? 'model',
      };
    }

    const cam = viewer.camera.positionCartographic;
    return {
      lat: CesiumMath.toDegrees(cam.latitude),
      lng: CesiumMath.toDegrees(cam.longitude),
      source: 'camera',
    };
  }

  // -- Close --
  function closeModal() {
    closed = true;
    if (leafletMap) {
      leafletMap.remove();
      leafletMap = null;
    }
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  // -- Add button handler --
  async function handleAdd(src) {
    const addBtn = addBtns[src.id];
    addBtn.disabled = true;
    addBtn.textContent = t('modal.adding');
    statusLine.style.color = '';
    statusLine.textContent = '';

    try {
      if (src.areaCapKm2 !== null && currentBounds) {
        const area = bboxAreaKm2(currentBounds);
        if (area > src.areaCapKm2) {
          statusLine.style.color = '#f39c12';
          statusLine.textContent = t('modal.areaTooLarge', { area: area.toFixed(1), cap: src.areaCapKm2 });
          return;
        }
      }

      let layerData, layerType, layerLabel, count, sourceConfig;

      if (src.id === 'osm-trees') {
        const result = await fetchOsmTrees(viewer, currentBounds);
        layerData = result.entities;
        layerType = 'entities';
        layerLabel = t('modal.osmTreesLabel', { count: result.count });
        count = result.count;
        sourceConfig = { kind: 'osm-trees', nodes: result.nodes };
      } else if (src.id === 'plateau-3dtiles') {
        progressEl.hidden = false;
        progressEl.max = 1;
        progressEl.value = 0;
        try {
          const result = await addSelectedPlateauLayers(
            loadTilesetFromUrl,
            onLayerAdded,
            (current, total) => {
              progressEl.max = total;
              progressEl.value = current;
              statusLine.style.color = '';
              statusLine.textContent = t('loading.plateau.progress', { current, total });
            },
          );
          statusLine.style.color = result.failures.length ? '#f39c12' : '#3db84b';
          statusLine.textContent = result.failures.length
            ? t('modal.loadedLayersWithFailures', { count: result.loaded, failures: result.failures.length })
            : t('modal.loadedLayers', { count: result.loaded });
        } finally {
          progressEl.hidden = true;
        }
        return;
      } else if (src.id === 'osm-buildings') {
        const result = await fetchOsmBuildings(viewer, currentBounds);
        layerData = result.dataSource;
        layerType = 'datasource';
        layerLabel = t('modal.osmBuildingsLabel', { count: result.count });
        count = result.count;
        sourceConfig = { kind: 'osm-buildings', features: result.features };
      }

      onLayerAdded({
        id: crypto.randomUUID(),
        label: layerLabel,
        type: layerType,
        data: layerData,
        visible: true,
        sourceConfig,
      });

      statusLine.style.color = '#3db84b';
      statusLine.textContent = count !== null ? t('modal.loadedFeatures', { count }) : t('modal.loadedOk');
    } catch (e) {
      console.error(e);
      statusLine.style.color = '#e74c3c';
      const msg = e instanceof Error ? e.message
        : e?.statusCode ? `HTTP ${e.statusCode}`
        : typeof e === 'string' ? e
        : t('modal.networkError');
      statusLine.textContent = t('modal.error', { msg });
    } finally {
      addBtn.disabled = false;
      addBtn.textContent = t('modal.add');
    }
  }

  async function addSelectedPlateauLayers(loadTileset, addLayer, onProgress) {
    if (!plateauCatalog) plateauCatalog = await fetchPlateauCatalog();
    if (selectedPlateauAreas.length === 0) throw new Error(t('plateau.areaRequired'));

    const choices = plateauCatalog.listChoicesFor(selectedPlateauAreas, {
      getTypeLabel: getPlateauTypeLabel,
    })
      .filter(choice => selectedPlateauTypes.has(choice.code));
    if (choices.length === 0) throw new Error(t('plateau.selectCategoryRequired'));

    const failures = [];
    let loaded = 0;
    const total = choices.length;
    onProgress?.(0, total);

    for (const [i, choice] of choices.entries()) {
      try {
        const tileset = await loadTileset(viewer, choice.url);
        addLayer({
          id: crypto.randomUUID(),
          label: t('modal.plateauLayerLabel', {
            area: choice.area.label,
            type: choice.label,
            lod: choice.lod ?? '-',
            textureLabel: choice.texture === true ? t('modal.textured') : t('modal.notTextured'),
          }),
          type: 'tileset',
          data: tileset,
          visible: true,
          sourceConfig: {
            kind: 'plateau-3dtiles',
            url: choice.url,
            areaCode: choice.area.code,
            areaLabel: choice.area.label,
            featureType: choice.code,
            featureLabel: choice.label,
            lod: choice.lod,
            texture: choice.texture,
          },
        });
        loaded++;
      } catch (e) {
        console.error(e);
        failures.push(choice.label);
      }
      onProgress?.(i + 1, total);
    }

    if (loaded === 0 && failures.length > 0) {
      throw new Error(t('modal.plateauAllFailed'));
    }

    return { loaded, failures };
  }
}

// -- Data fetchers --

async function fetchOsmTrees(viewer, bounds) {
  const s = bounds.getSouth(), w = bounds.getWest(), n = bounds.getNorth(), e = bounds.getEast();
  const query = `[out:json][bbox:${s},${w},${n},${e}];\n(node["natural"="tree"]; node["natural"="wood"];);\nout body;`;
  const resp = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: 'data=' + encodeURIComponent(query),
  });
  if (!resp.ok) throw new Error(`Overpass API returned ${resp.status}`);
  const data = await resp.json();

  const nodes = data.elements
    .filter(el => el.type === 'node')
    .map(el => ({ lat: el.lat, lon: el.lon }));
  const entities = createTreeEntities(viewer, nodes);
  return { entities, count: nodes.length, nodes };
}

function createTreeEntities(viewer, nodes) {
  const entities = [];
  for (const { lat, lon } of nodes) {
    entities.push(
      viewer.entities.add({
        position: Cartesian3.fromDegrees(lon, lat, 0.75),
        cylinder: {
          length: 1.5,
          topRadius: 0.2,
          bottomRadius: 0.2,
          material: Color.fromCssColorString('#795548'),
          heightReference: HeightReference.RELATIVE_TO_GROUND,
        },
      })
    );
    entities.push(
      viewer.entities.add({
        position: Cartesian3.fromDegrees(lon, lat, 3.5),
        cylinder: {
          length: 4,
          topRadius: 0,
          bottomRadius: 1.8,
          material: Color.fromCssColorString('#2d9e3a'),
          heightReference: HeightReference.RELATIVE_TO_GROUND,
        },
      })
    );
  }
  return entities;
}

async function fetchPlateauCatalog() {
  if (!plateauCatalogPromise) {
    plateauCatalogPromise = fetch(PLATEAU_CATALOG_API, {
      headers: { Accept: 'application/json' },
    })
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`PLATEAU catalog API returned HTTP ${resp.status}`);
        return normalizePlateauCatalog(await resp.json());
      })
      .catch((e) => {
        plateauCatalogPromise = null;
        throw e;
      });
  }
  return plateauCatalogPromise;
}

async function detectPlateauAreaFromPosition(position, catalog) {
  const url = new URL(GSI_REVERSE_GEOCODER_API);
  url.searchParams.set('lat', String(position.lat));
  url.searchParams.set('lon', String(position.lng));

  const resp = await fetch(url.toString());
  if (!resp.ok) return null;
  const data = await resp.json();
  const code = normalizeCode(data?.results?.muniCd);
  if (!code) return null;

  const area = catalog.findAreaByCode(code);
  if (!area) return null;

  return {
    area,
    source: position.source === 'camera' ? 'camera' : position.source === 'map' ? 'map' : 'model',
  };
}

async function detectPlateauAreasFromPositions(positions, catalog) {
  const seen = new Set();
  const detected = [];
  for (const position of positions) {
    try {
      const result = await detectPlateauAreaFromPosition(position, catalog);
      if (!result?.area?.code || seen.has(result.area.code)) continue;
      seen.add(result.area.code);
      detected.push(result);
    } catch {
      // Ignore individual reverse-geocode failures; other sampled points may still resolve.
    }
  }
  return detected;
}

function getPlateauTypeLabel(code, fallback) {
  const key = PLATEAU_TYPE_LABEL_KEYS[code];
  return key ? t(key) : fallback || code;
}

function formatPlateauChoiceMeta(choice) {
  const textures = Array.isArray(choice.textures) ? choice.textures : [choice.texture];
  const textureLabel = textures.length > 1
    ? t('plateau.mixedTextures')
    : textures[0] === true
    ? t('plateau.textured')
    : t('plateau.noTextures');
  const lods = Array.isArray(choice.lods) ? choice.lods : [choice.lod].filter(Boolean);
  const lod = lods.length > 0 ? lods.join(', ') : '-';
  const areaPrefix = choice.areaCount > 1
    ? `${t('plateau.categoryAreaCount', { count: choice.areaCount })} · `
    : '';
  const warning = choice.texturedOnly ? ` · ${t('plateau.texturedOnly')}` : '';
  return areaPrefix + t('plateau.categoryMeta', {
    lod,
    texture: textureLabel,
  }) + warning;
}

function formatPlateauAreaInput(area) {
  return `${area.label} (${area.code})`;
}

function formatPlateauAreasLabel(areas) {
  const unique = uniquePlateauAreas(areas);
  if (unique.length === 0) return t('modal.areaUnknown');
  if (unique.length <= 2) return unique.map(area => area.label).join(', ');
  return t('plateau.areaCount', { count: unique.length });
}

function getPlateauAreaSourceLabel(source) {
  if (source === 'manual') return t('plateau.areaManual');
  if (source === 'camera') return t('plateau.areaFromCamera');
  if (source === 'map') return t('plateau.areaFromMap');
  return t('plateau.areaFromModel');
}

function samplePlateauPositionsForBounds(bounds) {
  if (!bounds) return [];
  const south = bounds.getSouth();
  const west = bounds.getWest();
  const north = bounds.getNorth();
  const east = bounds.getEast();
  const midLat = (south + north) / 2;
  const midLng = (west + east) / 2;
  const points = [
    [midLat, midLng],
    [north, west],
    [north, midLng],
    [north, east],
    [midLat, west],
    [midLat, east],
    [south, west],
    [south, midLng],
    [south, east],
  ];

  const seen = new Set();
  return points
    .map(([lat, lng]) => ({ lat, lng, source: 'map' }))
    .filter((point) => {
      if (!isFiniteLatLng(point)) return false;
      const key = `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function isFiniteLatLng(value) {
  return Number.isFinite(value?.lat) && Number.isFinite(value?.lng);
}

async function fetchOsmBuildings(viewer, bounds) {
  const s = bounds.getSouth(), w = bounds.getWest(), n = bounds.getNorth(), e = bounds.getEast();
  const query = `[out:json][bbox:${s},${w},${n},${e}];\n(way["building"]; relation["building"];);\nout body geom;`;
  const resp = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: 'data=' + encodeURIComponent(query),
  });
  if (!resp.ok) throw new Error(`Overpass API returned ${resp.status}`);
  const data = await resp.json();
  const { features } = overpassToGeoJSON(data.elements);
  const dataSource = await createOsmBuildingsDataSource(viewer, features);
  return { dataSource, count: features.length, features };
}

async function createOsmBuildingsDataSource(viewer, features) {
  const geojson = { type: 'FeatureCollection', features };
  const ds = await GeoJsonDataSource.load(geojson, {
    fill: Color.WHITE.withAlpha(0.3),
    stroke: Color.fromCssColorString('#29b6f6'),
    strokeWidth: 1.5,
  });
  const now = JulianDate.now();
  for (const entity of ds.entities.values) {
    if (!entity.polygon) continue;
    const props = entity.properties?.getValue(now) ?? {};
    let height = parseFloat(props.height) || 0;
    if (!height) {
      const levels = parseFloat(props['building:levels']) || 0;
      height = levels > 0 ? levels * 3.5 : 10;
    }
    entity.polygon.extrudedHeight = height;
    entity.polygon.extrudedHeightReference = HeightReference.RELATIVE_TO_GROUND;
    entity.polygon.heightReference = HeightReference.CLAMP_TO_GROUND;
    entity.polygon.height = 0;
  }
  viewer.dataSources.add(ds);
  return ds;
}

// -- Utilities --

function overpassToGeoJSON(elements) {
  const features = [];
  for (const el of elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 3) continue;
    const coords = el.geometry.map(p => [p.lon, p.lat]);
    const first = coords[0], last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) coords.push([...coords[0]]);
    features.push({
      type: 'Feature',
      properties: el.tags ?? {},
      geometry: { type: 'Polygon', coordinates: [coords] },
    });
  }
  return { type: 'FeatureCollection', features };
}

function bboxAreaKm2(bounds) {
  const R = 6371;
  const dLat = (bounds.getNorth() - bounds.getSouth()) * Math.PI / 180;
  const dLng = (bounds.getEast() - bounds.getWest()) * Math.PI / 180;
  const midLat = ((bounds.getNorth() + bounds.getSouth()) / 2) * Math.PI / 180;
  return Math.abs(R * R * dLat * dLng * Math.cos(midLat));
}

export async function restoreImportedLayer(viewer, loadTilesetFromUrl, savedLayer) {
  const { label, visible, sourceConfig } = savedLayer;
  if (!sourceConfig) return null;

  if (sourceConfig.kind === 'plateau-buildings' || sourceConfig.kind === 'plateau-3dtiles') {
    const tileset = await loadTilesetFromUrl(viewer, sourceConfig.url);
    tileset.show = visible;
    return { id: crypto.randomUUID(), label, type: 'tileset', data: tileset, visible, sourceConfig };
  }

  if (sourceConfig.kind === 'osm-trees') {
    const entities = createTreeEntities(viewer, sourceConfig.nodes ?? []);
    if (!visible) entities.forEach(e => (e.show = false));
    return { id: crypto.randomUUID(), label, type: 'entities', data: entities, visible, sourceConfig };
  }

  if (sourceConfig.kind === 'osm-buildings') {
    const ds = await createOsmBuildingsDataSource(viewer, sourceConfig.features ?? []);
    ds.show = visible;
    return { id: crypto.randomUUID(), label, type: 'datasource', data: ds, visible, sourceConfig };
  }

  return null;
}
