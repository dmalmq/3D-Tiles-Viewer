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
import {
  meshCodeFor,
  meshCodesInBounds,
  meshBounds,
  meshNeighborhood,
  meshSamplePoints,
  normalizeMeshCodes,
} from './plateauGrid.js';
import {
  PLATEAU_TILESET_OPTIONS,
  createPlateauSubsetUrl,
  downloadPlateauToCache,
  formatMegabytes,
  isPlateauCacheAvailable,
  loadSavedPlateauTileset,
} from './plateauLayerSource.js';

const PLATEAU_CATALOG_API = 'https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets';
const GSI_REVERSE_GEOCODER_API = 'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress';

const DEFAULT_PLATEAU_TYPES = ['bldg'];
// Below this zoom 1 km cells are only a few pixels wide; draw just the
// selection instead of the whole grid.
const PLATEAU_GRID_MIN_ZOOM = 12;
const PLATEAU_GRID_MAX_CELLS = 3000;
const REVERSE_GEOCODE_CONCURRENCY = 4;
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
  // 'grid': load only the selected 1 km cells (areas follow from the cells).
  // 'area': load a whole municipality picked in the search box.
  let plateauSelectionMode = 'grid';
  let selectedMeshCodes = [];
  let plateauGridSource = null;
  let plateauAreaResolving = false;
  let plateauAreaResolveSeq = 0;
  let plateauDownloadEnabled = true;
  let plateauCacheAvailable = null;
  let plateauGridLayer = null;
  let bboxRect = null;
  let plateauGridStatus = null;
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
    renderBboxRect();
    renderPlateauGrid();
  }

  function updateDescPane(src) {
    descPane.innerHTML = '';
    plateauAreaInput = null;
    plateauAreaDatalist = null;
    plateauTypeList = null;
    plateauStatus = null;
    plateauGridStatus = null;

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
    // -- Grid cells --
    const gridTitle = document.createElement('div');
    gridTitle.className = 'import-plateau-type-title';
    gridTitle.textContent = t('plateau.gridLabel');
    descPane.appendChild(gridTitle);

    const gridHint = document.createElement('p');
    gridHint.className = 'import-plateau-hint';
    gridHint.textContent = t('plateau.gridHint');
    descPane.appendChild(gridHint);

    const gridRow = document.createElement('div');
    gridRow.className = 'import-plateau-grid-row';
    plateauGridStatus = document.createElement('span');
    plateauGridStatus.className = 'import-plateau-grid-status';
    const aroundBtn = document.createElement('button');
    aroundBtn.type = 'button';
    aroundBtn.className = 'import-plateau-grid-btn';
    aroundBtn.textContent = t('plateau.gridAroundModel');
    aroundBtn.addEventListener('click', () => selectCellsAroundPreferredPosition());
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'import-plateau-grid-btn';
    clearBtn.textContent = t('plateau.gridClear');
    clearBtn.addEventListener('click', () => setSelectedMeshCodes([], 'manual'));
    gridRow.appendChild(plateauGridStatus);
    gridRow.appendChild(aroundBtn);
    gridRow.appendChild(clearBtn);
    descPane.appendChild(gridRow);

    // -- Whole municipality (optional override) --
    const areaRow = document.createElement('div');
    areaRow.className = 'import-plateau-option-row';

    const areaLabel = document.createElement('span');
    areaLabel.className = 'import-plateau-option-label';
    areaLabel.textContent = t('plateau.wholeAreaLabel');

    plateauAreaInput = document.createElement('input');
    plateauAreaInput.className = 'import-plateau-select';
    plateauAreaInput.type = 'text';
    plateauAreaInput.setAttribute('list', 'plateauAreaOptions');
    plateauAreaInput.placeholder = t('plateau.areaPlaceholder');
    plateauAreaInput.addEventListener('change', () => {
      const value = plateauAreaInput.value.trim();
      if (!value) {
        useGridSelection();
        return;
      }

      const area = findPlateauAreaByInput(value);
      if (area) {
        plateauSelectionMode = 'area';
        plateauAreaResolveSeq++;
        plateauAreaResolving = false;
        selectedPlateauAreas = [area];
        syncPlateauTypeSelection();
        renderPlateauControls();
        renderPlateauGrid();
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

    // -- Local copy --
    const downloadRow = document.createElement('label');
    downloadRow.className = 'import-plateau-category-row import-plateau-download-row';
    const downloadCheckbox = document.createElement('input');
    downloadCheckbox.type = 'checkbox';
    downloadCheckbox.checked = plateauDownloadEnabled && plateauCacheAvailable !== false;
    downloadCheckbox.disabled = plateauCacheAvailable === false;
    downloadCheckbox.addEventListener('change', () => {
      plateauDownloadEnabled = downloadCheckbox.checked;
    });
    const downloadText = document.createElement('span');
    downloadText.className = 'import-plateau-category-text';
    const downloadName = document.createElement('span');
    downloadName.className = 'import-plateau-category-name';
    downloadName.textContent = t('plateau.downloadLabel');
    const downloadMeta = document.createElement('span');
    downloadMeta.className = 'import-plateau-category-meta';
    downloadMeta.textContent = plateauCacheAvailable === false
      ? t('plateau.downloadUnavailable')
      : t('plateau.downloadHint');
    downloadText.appendChild(downloadName);
    downloadText.appendChild(downloadMeta);
    downloadRow.appendChild(downloadCheckbox);
    downloadRow.appendChild(downloadText);
    descPane.appendChild(downloadRow);
  }

  function renderPlateauControls() {
    if (!plateauAreaInput || !plateauTypeList || !plateauStatus) return;

    plateauAreaInput.value = plateauSelectionMode === 'area' && selectedPlateauAreas.length === 1
      ? formatPlateauAreaInput(selectedPlateauAreas[0])
      : '';
    populatePlateauAreaDatalist();
    if (plateauGridStatus) {
      plateauGridStatus.textContent = plateauSelectionMode === 'area'
        ? t('plateau.gridInactive')
        : selectedMeshCodes.length
        ? t('plateau.gridCount', { count: selectedMeshCodes.length })
        : t('plateau.gridNone');
    }

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

    if (plateauAreaResolving && selectedPlateauAreas.length === 0) {
      plateauStatus.textContent = t('plateau.gridResolving');
      renderPlateauEmptyTypeList(t('plateau.noCategories'));
      return;
    }

    if (selectedPlateauAreas.length === 0) {
      plateauStatus.textContent = plateauSelectionMode === 'grid' && selectedMeshCodes.length > 0
        ? t('plateau.gridNoArea')
        : t('plateau.areaRequired');
      renderPlateauEmptyTypeList(t('plateau.noCategories'));
      return;
    }

    const choices = plateauCatalog.listCategoryChoicesFor(selectedPlateauAreas, {
      getTypeLabel: getPlateauTypeLabel,
    });
    syncPlateauTypeSelection(choices);
    plateauStatus.textContent = plateauSelectionMode === 'area'
      ? t('plateau.areaStatus', {
        area: formatPlateauAreasLabel(selectedPlateauAreas),
        source: t('plateau.areaManual'),
      })
      : t('plateau.gridStatus', {
        area: formatPlateauAreasLabel(selectedPlateauAreas),
        source: getPlateauGridSourceLabel(plateauGridSource),
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
        const areas = selectedPlateauAreas.length ? formatPlateauAreasLabel(selectedPlateauAreas) : null;
        areaSpans[src.id].textContent = plateauSelectionMode === 'grid' && selectedMeshCodes.length
          ? t('plateau.gridSourceArea', { count: selectedMeshCodes.length, area: areas ?? '–' })
          : areas ?? t('modal.areaUnknown');
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
  isPlateauCacheAvailable().then((available) => {
    plateauCacheAvailable = available;
    if (!closed && selectedSourceId === 'plateau-3dtiles') updateDescPane(SOURCES.find(s => s.id === selectedSourceId));
  });

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
    plateauGridLayer = L.layerGroup().addTo(leafletMap);

    const onMapChange = () => {
      renderBboxRect();
      renderPlateauGrid();
      updateAreaLabels(leafletMap.getBounds());
    };

    leafletMap.on('moveend zoomend', onMapChange);
    leafletMap.on('click', (e) => {
      if (selectedSourceId !== 'plateau-3dtiles') return;
      const code = meshCodeFor(e.latlng.lat, e.latlng.lng);
      if (!code) return;
      const base = plateauSelectionMode === 'grid' ? selectedMeshCodes : [];
      const next = base.includes(code) ? base.filter(c => c !== code) : [...base, code];
      setSelectedMeshCodes(next, 'manual');
    });
    onMapChange();
    if (selectedMeshCodes.length) fitMapToCells(selectedMeshCodes);
    leafletMap.invalidateSize();
  }, 0);

  // The dashed extent box only means something for the bbox-based sources.
  function renderBboxRect() {
    if (!leafletMap) return;
    if (bboxRect) {
      leafletMap.removeLayer(bboxRect);
      bboxRect = null;
    }
    if (selectedSourceId === 'plateau-3dtiles') return;
    bboxRect = L.rectangle(leafletMap.getBounds(), {
      color: '#4da6ff',
      weight: 2,
      fillOpacity: 0.08,
      interactive: false,
    }).addTo(leafletMap);
  }

  function renderPlateauGrid() {
    if (!leafletMap || !plateauGridLayer) return;
    plateauGridLayer.clearLayers();
    mapPane.classList.toggle('plateau-grid-active', selectedSourceId === 'plateau-3dtiles');
    if (selectedSourceId !== 'plateau-3dtiles') return;

    const active = plateauSelectionMode === 'grid';
    const selected = new Set(active ? selectedMeshCodes : []);
    const view = leafletMap.getBounds();
    const visible = leafletMap.getZoom() >= PLATEAU_GRID_MIN_ZOOM
      ? meshCodesInBounds({
        south: view.getSouth(),
        west: view.getWest(),
        north: view.getNorth(),
        east: view.getEast(),
      }, PLATEAU_GRID_MAX_CELLS) ?? []
      : [];

    for (const code of new Set([...visible, ...selected])) {
      const b = meshBounds(code);
      const isSelected = selected.has(code);
      const rect = L.rectangle([[b.south, b.west], [b.north, b.east]], {
        color: isSelected ? '#ff9f1c' : '#4da6ff',
        weight: isSelected ? 2 : 1,
        opacity: isSelected ? 0.95 : 0.45,
        fillColor: isSelected ? '#ff9f1c' : '#4da6ff',
        fillOpacity: isSelected ? 0.25 : 0.02,
        interactive: false,
      });
      plateauGridLayer.addLayer(rect);
    }
  }

  function fitMapToCells(codes) {
    if (!leafletMap || codes.length === 0) return;
    const bounds = codes.map(meshBounds).filter(Boolean);
    leafletMap.fitBounds([
      [Math.min(...bounds.map(b => b.south)), Math.min(...bounds.map(b => b.west))],
      [Math.max(...bounds.map(b => b.north)), Math.max(...bounds.map(b => b.east))],
    ], { padding: [24, 24], maxZoom: 15 });
  }

  function setSelectedMeshCodes(codes, source) {
    plateauSelectionMode = 'grid';
    selectedMeshCodes = normalizeMeshCodes(codes);
    plateauGridSource = source;
    renderPlateauGrid();
    resolveAreasForSelectedCells();
  }

  function useGridSelection() {
    plateauSelectionMode = 'grid';
    renderPlateauGrid();
    resolveAreasForSelectedCells();
  }

  function selectCellsAroundPreferredPosition() {
    const position = getPreferredPlateauPosition();
    const center = meshCodeFor(position.lat, position.lng);
    setSelectedMeshCodes(center ? meshNeighborhood(center) : [], position.source);
    fitMapToCells(selectedMeshCodes);
  }

  async function initializePlateauCatalogAndArea() {
    const position = getPreferredPlateauPosition();
    const center = meshCodeFor(position.lat, position.lng);
    selectedMeshCodes = center ? meshNeighborhood(center) : [];
    plateauGridSource = position.source;
    renderPlateauGrid();
    if (leafletMap && selectedMeshCodes.length) fitMapToCells(selectedMeshCodes);

    try {
      plateauCatalog = await fetchPlateauCatalog();
      if (closed || !overlay.isConnected) return;
    } catch (e) {
      plateauCatalogError = e instanceof Error ? e : new Error(String(e));
    }
    renderPlateauControls();
    await resolveAreasForSelectedCells();
  }

  // Municipalities come from reverse-geocoding each cell's centre and
  // corners; a cell on a ward boundary pulls in both wards, and the tileset
  // cut later drops whichever has no tiles inside the cells.
  async function resolveAreasForSelectedCells() {
    const seq = ++plateauAreaResolveSeq;
    if (plateauSelectionMode !== 'grid') return;
    if (!plateauCatalog || selectedMeshCodes.length === 0) {
      selectedPlateauAreas = [];
      plateauAreaResolving = false;
      renderPlateauControls();
      updateAreaLabels(currentBounds);
      return;
    }

    plateauAreaResolving = true;
    renderPlateauControls();
    updateAreaLabels(currentBounds);
    try {
      const detected = await detectPlateauAreasFromPositions(meshSamplePoints(selectedMeshCodes), plateauCatalog);
      if (closed || !overlay.isConnected || seq !== plateauAreaResolveSeq || plateauSelectionMode !== 'grid') return;
      selectedPlateauAreas = uniquePlateauAreas(detected.map(entry => entry.area));
    } catch (e) {
      console.warn('PLATEAU area detection failed:', e);
      if (seq !== plateauAreaResolveSeq) return;
      selectedPlateauAreas = [];
    }
    plateauAreaResolving = false;
    syncPlateauTypeSelection();
    renderPlateauControls();
    updateAreaLabels(currentBounds);
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
            ({ done, total, message }) => {
              progressEl.max = Math.max(total, 1);
              progressEl.value = done;
              statusLine.style.color = '';
              statusLine.textContent = message;
            },
          );
          statusLine.style.color = result.failures.length ? '#f39c12' : '#3db84b';
          statusLine.textContent = result.failures.length
            ? t('modal.loadedLayersWithFailures', { count: result.loaded, failures: result.failures.length })
              + ' ' + result.failures[0].message
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

    const meshCodes = plateauSelectionMode === 'grid' ? [...selectedMeshCodes] : [];
    const download = plateauDownloadEnabled && plateauCacheAvailable !== false;
    const failures = [];
    let loaded = 0;
    let empty = 0;
    const total = choices.length;

    for (const [i, choice] of choices.entries()) {
      const name = `${choice.label} – ${choice.area.label}`;
      const layerProgress = t('loading.plateau.progress', { current: i + 1, total });
      onProgress?.({ done: i, total, message: `${layerProgress} ${name}` });
      try {
        const source = await preparePlateauSource(choice, meshCodes, download, name, (progress) => {
          onProgress?.({
            done: progress.done,
            total: progress.total,
            message: t('plateau.downloadProgress', {
              layer: layerProgress,
              name,
              done: progress.done,
              total: progress.total,
              mb: formatMegabytes(progress.bytes),
            }),
          });
        });
        // A ward pulled in by a boundary cell may have no tiles inside the cells.
        if (!source) {
          empty++;
          continue;
        }

        const tileset = await loadTileset(viewer, source.loadUrl, { tilesetOptions: PLATEAU_TILESET_OPTIONS });
        const labelParams = {
          area: choice.area.label,
          type: choice.label,
          lod: choice.lod ?? '-',
          textureLabel: choice.texture === true ? t('modal.textured') : t('modal.notTextured'),
          cells: meshCodes.length,
        };
        addLayer({
          id: crypto.randomUUID(),
          label: t(meshCodes.length ? 'modal.plateauGridLayerLabel' : 'modal.plateauLayerLabel', labelParams),
          type: 'tileset',
          data: tileset,
          visible: true,
          sourceConfig: {
            kind: 'plateau-3dtiles',
            // Streamed grid subsets load from a blob URL that cannot be saved,
            // so persist the PLATEAU URL and rebuild the cut on restore.
            url: source.storage === 'local' ? source.loadUrl : choice.url,
            remoteUrl: choice.url,
            storage: source.storage,
            ...(meshCodes.length ? { meshCodes } : {}),
            ...(source.cacheKey ? { cacheKey: source.cacheKey } : {}),
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
        failures.push({ label: name, message: e instanceof Error ? e.message : String(e) });
      }
      onProgress?.({ done: i + 1, total, message: layerProgress });
    }

    if (loaded === 0 && failures.length > 0) {
      throw new Error(`${t('modal.plateauAllFailed')} ${failures[0].message}`);
    }
    if (loaded === 0 && empty > 0) {
      throw new Error(t('plateau.nothingInCells'));
    }

    return { loaded, failures };
  }

  async function preparePlateauSource(choice, meshCodes, download, name, onDownloadProgress) {
    if (download) {
      const entry = await downloadPlateauToCache(
        { sourceUrl: choice.url, meshCodes, label: name },
        onDownloadProgress,
      );
      if (entry.fileCount === 0) return null;
      return { loadUrl: entry.url, storage: 'local', cacheKey: entry.key };
    }
    if (meshCodes.length > 0) {
      const subset = await createPlateauSubsetUrl({ url: choice.url, meshCodes });
      return subset.url ? { loadUrl: subset.url, storage: 'remote' } : null;
    }
    return { loadUrl: choice.url, storage: 'remote' };
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

const reverseGeocodeCache = new Map();

function reverseGeocodeMuniCode(position) {
  const key = `${position.lat.toFixed(6)},${position.lng.toFixed(6)}`;
  if (!reverseGeocodeCache.has(key)) {
    const url = new URL(GSI_REVERSE_GEOCODER_API);
    url.searchParams.set('lat', String(position.lat));
    url.searchParams.set('lon', String(position.lng));
    const promise = fetch(url.toString())
      .then(resp => (resp.ok ? resp.json() : null))
      .then(data => normalizeCode(data?.results?.muniCd))
      .catch((e) => {
        reverseGeocodeCache.delete(key);
        throw e;
      });
    reverseGeocodeCache.set(key, promise);
  }
  return reverseGeocodeCache.get(key);
}

async function detectPlateauAreaFromPosition(position, catalog) {
  const code = await reverseGeocodeMuniCode(position);
  if (!code) return null;

  const area = catalog.findAreaByCode(code);
  if (!area) return null;
  return { area };
}

async function detectPlateauAreasFromPositions(positions, catalog) {
  const results = new Array(positions.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < positions.length) {
      const index = next++;
      try {
        results[index] = await detectPlateauAreaFromPosition(positions[index], catalog);
      } catch {
        // Ignore individual reverse-geocode failures; other sampled points may still resolve.
      }
    }
  };
  await Promise.all(Array.from({ length: REVERSE_GEOCODE_CONCURRENCY }, worker));

  const seen = new Set();
  const detected = [];
  for (const result of results) {
    if (!result?.area?.code || seen.has(result.area.code)) continue;
    seen.add(result.area.code);
    detected.push(result);
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

function getPlateauGridSourceLabel(source) {
  if (source === 'manual') return t('plateau.gridFromManual');
  if (source === 'camera') return t('plateau.gridFromCamera');
  return t('plateau.gridFromModel');
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
    const tileset = await loadSavedPlateauTileset(viewer, loadTilesetFromUrl, sourceConfig);
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
