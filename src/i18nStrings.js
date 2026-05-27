/**
 * UI translation tables.
 *
 * Conventions:
 * - Acronyms / brand names (LOD, WGS84, GeoJSON, GLB, Cesium Ion, PLATEAU,
 *   OpenStreetMap) stay in Latin script in both languages.
 * - Data values (Revit link names, level names, ward names, file names) are
 *   pass-through and are NOT translated here.
 * - Keep `{name}` placeholders identical across languages.
 */

const en = {
  // Header
  "header.title": "3D Tiles Viewer",
  "header.save": "Save",
  "header.load": "Load",
  "header.theme.title": "Toggle light/dark theme",
  "header.theme.aria": "Toggle theme",
  "header.lang.title": "Switch language",
  "header.lang.aria": "Switch language",
  "search.placeholder": "Search points…",
  "search.noMatches": "No matches",
  "search.subtitleUnassigned": "{layer} · Unassigned",
  "search.untitledPoint": "Untitled point",

  // Sections
  "section.import": "Import Data",
  "section.models": "3D Models",
  "section.cityGml": "CityGML Layers",
  "section.basemap": "Basemap",
  "section.floors": "Floor Levels",
  "section.placement": "Placement",
  "section.scene": "Scene",
  "section.environment": "Environment",
  "section.importedLayers": "Imported Layers",

  // Left action bar / Add Data menu / settings popover
  "leftBar.addData": "+ Add Data",
  "leftBar.addData.title": "Add data to the scene",
  "leftBar.settings.title": "Settings",
  "addData.url": "Tileset URL…",
  "addData.folder": "Tileset folder…",
  "addData.cityGml": "CityGML (.gml)…",
  "addData.gdbZip": "Geodatabase (.gdb.zip)…",
  "addData.gdbFolder": "Geodatabase folder…",
  "addData.shp": "Shapefile (.zip)…",
  "addData.gdbReassign": "Reassign GDB layers…",
  "addData.catalog": "PLATEAU catalog…",
  "scene.filterPlaceholder": "Filter scene…",
  "scene.itemsCount": "{count} items",
  "scene.itemsCountFiltered": "{filtered}/{total} items",
  "scene.empty": "No models. Click + Add Data.",
  "settings.title": "Settings",
  "dnd.tooltip": "Drag to reassign — or right-click for menu",

  // Context menus (scene tree)
  "ctx.building.addLevel": "Add level…",
  "ctx.building.setBaseElev": "Set base elevation…",
  "ctx.building.shiftTileset": "Shift tileset…",
  "ctx.level.editName": "Edit name…",
  "ctx.level.editElev": "Edit elevation…",
  "ctx.layer.adjustHeight": "Adjust height…",
  "ctx.layer.resetHeight": "Reset height offset",
  "ctx.layer.configureColors": "Configure colors…",
  "ctx.layer.remove": "Remove",

  // Color config modal
  "colorConfig.title": "Configure layer colors",
  "colorConfig.column": "Column",
  "colorConfig.value": "Value",
  "colorConfig.color": "Color",
  "colorConfig.loadPalette": "Load palette",
  "colorConfig.savePalette": "Save as palette…",
  "colorConfig.savePalettePrompt": "Palette name",
  "colorConfig.resetDefaults": "Reset to defaults",
  "colorConfig.defaultPaletteName": "Default",
  "colorConfig.customColor": "Custom…",
  "colorConfig.apply": "Apply",
  "colorConfig.cancel": "Cancel",
  "colorConfig.overwritePalette": "A palette named \"{name}\" already exists. Overwrite?",
  "colorConfig.importJson": "Import JSON…",
  "colorConfig.exportJson": "Export JSON",
  "colorConfig.importInvalid": "Couldn't read that palette file. Expected a Cesium layer-color palette JSON.",
  "colorConfig.importSaveToLibrary": "Save imported palette \"{name}\" to your library?",
  "colorConfig.noValues": "No distinct values found for this column.",
  "colorConfig.moreValuesNote": "+{count} more values use the default color (limit: 200 rows).",

  // Per-layer height offset
  "layer.heightOffsetTitle": "Height offset for this layer (m). Lifts the layer above (positive) or below (negative) its level's elevation.",

  // Popover labels
  "popover.ok": "OK",
  "popover.cancel": "Cancel",
  "popover.levelName": "Name",
  "popover.elevation": "Elevation (m)",
  "popover.baseElevation": "Base elevation (WGS84 m)",
  "popover.tilesetShift": "Shift tileset (m)",
  "popover.layerHeight": "Layer height offset (m)",

  // Import Data section (left panel)
  "import.button": "Import Data…",
  "import.empty": "No imported layers.",

  // 3D Models section
  "models.urlPlaceholder": "Tileset URL…",
  "models.loadUrl": "Load",
  "models.loadUrl.loading": "Loading...",
  "models.browse": "Browse Files…",
  "models.browse.loading": "Loading...",
  "models.browse.attaching": "Attaching…",
  "models.empty": "No models loaded.",
  "models.highestLodOnly": "Highest LOD only",
  "models.lodStatus": "{buildings} buildings tracked, {duplicates} lower-LOD duplicates hidden",

  // CityGML
  "cityGml.button": "Load .gml…",
  "cityGml.button.loading": "Loading…",
  "cityGml.empty": "No CityGML layers loaded.",

  // Basemap
  "basemap.tokenLabel": "Cesium Ion Token",
  "basemap.tokenPlaceholder": "Paste token here…",
  "basemap.applyToken": "Apply",
  "basemap.imageryLabel": "Imagery",
  "basemap.terrainLabel": "Terrain",
  "imagery.osm": "OpenStreetMap",
  "imagery.bingAerial": "Bing Aerial (Ion)",
  "imagery.sentinel": "Sentinel-2 (Ion)",
  "imagery.esriStreet": "Esri World Street Map",
  "imagery.esriTopo": "Esri World Topo Map",
  "imagery.esriImagery": "Esri World Imagery",
  "imagery.esriLightGray": "Esri Light Gray Canvas",
  "imagery.cartoPositron": "CartoDB Positron",
  "terrain.flat": "Flat (no elevation)",
  "terrain.cesiumWorld": "Cesium World Terrain (Ion)",
  "terrain.gsi5a": "Japan DEM 5A – GSI (free)",
  "terrain.gsi5b": "Japan DEM 5B – GSI (free)",
  "terrain.plateau": "PLATEAU Terrain (Japan)",

  // Right panel — selection placeholder + header
  "right.noSelection": "Select a 3D model<br/>to edit its properties",
  "right.zoomExtents.title": "Zoom to extents",
  "right.removeModel.title": "Remove model",
  "right.reload.message": "Model not loaded — select the folder to restore it.",
  "right.reload.button": "Re-load 3D Model…",
  "right.grant.message": "Access needed for folder: {folder}",
  "right.grant.button": "Grant access & reload",

  // Floor Levels
  "level.namePlaceholder": "2F",
  "level.elevPlaceholder": "Elevation (m)",
  "level.add": "Add",
  "level.baseElev": "Base elevation (WGS84 m)",
  "level.allFloors": "All floors",
  "level.removeTitle": "Remove level",
  "building.addShapefilesTitle": "Add shapefiles to this building",
  "building.addGdbTitle": "Add an Esri File Geodatabase (.gdb) to this building",
  "building.aliases.label": "Aliases",
  "building.aliases.placeholder": "Comma-separated, e.g. Oazo, オアゾ",
  "building.aliases.help": "Alternate names used to match GDB layer filenames to this building.",

  // Shapefile Layers
  "shp.removeTitle": "Remove shapefile",
  "shp.hide": "Hide",
  "shp.show": "Show",

  // Geodatabase (.gdb) Layers
  "gdb.pickZip": "Geodatabase (.gdb.zip or .zip)…",
  "gdb.pickFolder": "Geodatabase folder…",
  "gdb.loading": "Parsing geodatabase…",
  "gdb.section.title": "Geodatabase (.gdb)",

  // GDB import review dialog
  "gdb.dialog.title": "Import GDB layers",
  "gdb.dialog.subtitle": "{count} layers found. Review the building and floor for each, then click Import.",
  "gdb.dialog.col.layer": "Layer",
  "gdb.dialog.col.match": "Match",
  "gdb.dialog.col.building": "Building",
  "gdb.dialog.col.floor": "Floor",
  "gdb.dialog.bulk.selectAll": "Select all",
  "gdb.dialog.bulk.applyBuilding": "Building for selected",
  "gdb.dialog.bulk.applyFloor": "Floor for selected",
  "gdb.dialog.bulk.markSkip": "Mark selected as skip",
  "gdb.dialog.option.unassigned": "(Unassigned)",
  "gdb.dialog.option.skip": "(Skip)",
  "gdb.dialog.option.allFloors": "All floors",
  "gdb.dialog.option.choose": "—",
  "gdb.dialog.cancel": "Cancel",
  "gdb.dialog.import": "Import",
  "gdb.dialog.importSelected": "Import selected",
  "gdb.dialog.apply": "Apply",
  "gdb.dialog.reassignTitle": "Reassign GDB layers",
  "gdb.dialog.reassignSubtitle": "{count} existing GDB layers found. Select rows to move, skip, or leave unchanged.",
  "gdb.dialog.filter.placeholder": "Filter rows by name…",
  "gdb.reassign.button": "Reassign existing layers…",
  "gdb.reassign.empty": "No GDB layers to reassign yet.",
  "gdb.import.duplicatesSkipped": "Skipped {count} GDB layer(s) that already exist.",
  "gdb.dialog.featureCount": "{count} features · {geom}",
  "gdb.dialog.geom.polygon": "POLYGON",
  "gdb.dialog.geom.line": "LINE",
  "gdb.dialog.geom.point": "POINT",
  "gdb.dialog.geom.mixed": "MIXED",
  "gdb.confidence.high": "High confidence match",
  "gdb.confidence.medium": "Partial match",
  "gdb.confidence.none": "No name match",
  "gdb.dialog.floor.unresolvedTitle": "Auto-match could not determine a floor — layer will import at the building base.",
  "gdb.dialog.floor.perFeatureBadge": "(per-feature, {count} floors)",
  "gdb.dialog.floor.noFloor": "(no floor)",
  "gdb.dialog.floor.subRowCount": "{count} features",
  "gdb.dialog.parentRowHint": "set defaults, then select floors below",
  "gdb.unassigned.groupName": "Imported (drag to assign)",
  "gdb.unassigned.moveTitle": "Move to building",
  "ctx.layer.moveToFloor": "Move to floor",

  // Placement
  "placement.heightOffset": "Height Offset (m)",

  // Building list
  "building.removeTitle": "Remove building",
  "building.zoomTitle": "Zoom to building",
  "building.noModelBadge": "no model",
  "building.allBadge": "All",
  "building.chip.host": "host",
  "building.chip.link": "link",

  // Imported layers list
  "layer.toggleTitle": "Toggle visibility",
  "layer.removeTitle": "Remove",

  // Generic
  "generic.remove": "Remove",
  "generic.removeX": "×",

  // Panel toggles
  "panel.left.title": "Toggle left panel",
  "panel.left.aria": "Collapse left panel",
  "panel.right.title": "Toggle right panel",
  "panel.right.aria": "Collapse right panel",
  "panel.modelLevels": "Model levels",
  "panel.buildings": "Buildings",

  // Revit link split dialog
  "split.title": "Multiple Revit links detected",
  "split.bodyHtml":
    "This tileset contains <strong><span id=\"splitGroupCount\">0</span></strong> linked Revit models. Split into separate buildings?",
  "split.split": "Split",
  "split.merge": "Keep merged",
  "split.elements": "{count} elements",
  "split.confirmFallback":
    "Detected {count} linked Revit models. Split into separate buildings?",
  "split.hostFallback": "Host",

  // Alerts
  "alert.failedLoad": "Failed to load tileset:\n{message}",
  "alert.failedShp": "Failed to parse shapefile:\n{message}",
  "alert.failedGdb": "Failed to parse geodatabase:\n{message}",
  "alert.failedGml": "Failed to load CityGML:\n{message}",
  "alert.failedSession": "Failed to load session:\n{message}",
  "alert.nothingToSave": "Nothing to save.",

  // tilesetLoader
  "tileset.foundN": "Found {count} files, loading...",
  "tileset.loaded": "Loaded: {path}",
  "tileset.noJson": "No tileset.json found in selected folder.",
  "tileset.noPolygon": "No polygon geometry found in this CityGML file.",

  // Import Data modal — header + actions
  "modal.title": "Import Data",
  "modal.close": "Close",
  "modal.add": "Add",
  "modal.adding": "Loading…",
  "modal.free": "Free",
  "modal.learnMore": "Learn more",

  // Import Data modal — sources
  "sources.cat.vegetation": "Vegetation",
  "sources.cat.buildings": "Buildings",
  "sources.cat.cityModel": "City model",
  "sources.osmTrees.label": "OpenStreetMap Trees",
  "sources.osmTrees.desc":
    "Vegetation data from OpenStreetMap, a free open geographic database maintained by volunteers. Renders each tree as a green point clamped to terrain.",
  "sources.plateau.label": "PLATEAU 3D Tiles",
  "sources.plateau.desc":
    "3D city model datasets from Project PLATEAU, published by Japan's Ministry of Land, Infrastructure, Transport and Tourism (MLIT). Choose an area and the feature categories to import.",
  "sources.osmBuildings.label": "OSM Buildings",
  "sources.osmBuildings.desc":
    "Building footprints from OpenStreetMap. Rendered as flat polygon overlays clamped to terrain. Suitable for areas outside Japan.",

  // Import Data modal — PLATEAU options
  "plateau.areaLabel": "Area:",
  "plateau.areaPlaceholder": "Search municipality…",
  "plateau.areaRequired": "Choose a PLATEAU area before importing.",
  "plateau.areaNotFound": "No matching PLATEAU area.",
  "plateau.areaStatus": "{source}: {area}",
  "plateau.areaFromModel": "Detected from loaded model",
  "plateau.areaFromCamera": "Detected from camera",
  "plateau.areaFromMap": "Detected from map extent",
  "plateau.areaManual": "Selected area",
  "plateau.areaDetecting": "Detecting PLATEAU areas…",
  "plateau.areaNotDetected": "No PLATEAU area detected in this map extent.",
  "plateau.areaCount": "{count} areas",
  "plateau.catalogLoading": "Loading PLATEAU catalog…",
  "plateau.catalogError": "Could not load PLATEAU catalog: {message}",
  "plateau.categoriesLabel": "Categories",
  "plateau.noCategories": "No categories loaded.",
  "plateau.noCategoriesForArea": "No PLATEAU 3D Tiles categories found for this area.",
  "plateau.selectCategoryRequired": "Choose at least one PLATEAU category.",
  "plateau.categoryMeta": "LOD {lod} · {texture}",
  "plateau.categoryAreaCount": "{count} areas",
  "plateau.texturedOnly": "textured only",
  "plateau.mixedTextures": "Mixed textures",
  "plateau.wardLabel": "Ward:",
  "plateau.lodLabel": "LOD:",
  "plateau.texturesLabel": "Textures:",
  "plateau.textured": "Textured",
  "plateau.noTextures": "No textures",
  "plateau.lodOption": "LOD {n}",
  "plateau.feature.bldg": "Buildings",
  "plateau.feature.tran": "Roads / transport",
  "plateau.feature.brid": "Bridges",
  "plateau.feature.veg": "Vegetation",
  "plateau.feature.frn": "Urban fixtures",
  "plateau.feature.luse": "Land use",
  "plateau.feature.wtr": "Water bodies",
  "plateau.feature.fld": "Flood areas",
  "plateau.feature.tnm": "Terrain",
  "plateau.feature.urf": "Urban planning",
  "plateau.feature.dem": "DEM",

  // Import Data modal — feedback
  "modal.areaTooLarge": "Area too large ({area} km²). Max: {cap} km².",
  "modal.loadedFeatures": "Loaded {count} features.",
  "modal.loadedLayers": "Loaded {count} layers.",
  "modal.loadedLayersWithFailures": "Loaded {count} layers. {failures} failed.",
  "modal.loadedOk": "Loaded successfully.",
  "modal.error": "Error: {msg}",
  "modal.networkError": "Network or CORS error",
  "modal.osmTreesLabel": "OSM Trees ({count})",
  "modal.osmBuildingsLabel": "OSM Buildings ({count})",
  "modal.plateauLayerLabel": "PLATEAU – {area} – {type} – LOD{lod} – {textureLabel}",
  "modal.plateauAllFailed": "No selected PLATEAU layers could be loaded.",
  "modal.textured": "textured",
  "modal.notTextured": "no texture",
  "modal.areaUnknown": "—",
  "modal.areaPending": "…",
  "modal.areaKm2": "{area} km²",
  "modal.plateauNoData":
    "No PLATEAU 3D Tiles dataset found for {ward} with LOD{lod} and {textureLabel}.",
  "modal.plateauHasTextures": "textures",
  "modal.plateauNoTextures": "no textures",

  // PLATEAU feature overrides
  "plateau.manualTitle": "PLATEAU Feature",
  "plateau.noFeatureSelected": "No PLATEAU feature selected.",
  "plateau.transparent": "Transparent",
  "plateau.hideFeature": "Hide",
  "plateau.visible": "Visible",
  "plateau.overridesTitle": "Manual overrides",
  "plateau.clearAll": "Clear all",
  "plateau.noOverrides": "No manual overrides.",
  "plateau.mode.ghost": "transparent",
  "plateau.mode.hidden": "hidden",

  // PLATEAU overlap
  "building.plateauOverlap": "Ghost overlapping PLATEAU",

  // Loading indicators
  "loading.session.title": "Restoring session…",
  "loading.session.progress": "Loading {current} of {total}",
  "loading.plateau.progress": "Loading layer {current} of {total}…",
};

const ja = {
  // Header
  "header.title": "3D Tiles ビューア",
  "header.save": "保存",
  "header.load": "読み込み",
  "header.theme.title": "ライト／ダークテーマ切替",
  "header.theme.aria": "テーマ切替",
  "header.lang.title": "言語切替",
  "header.lang.aria": "言語切替",
  "search.placeholder": "ポイントを検索…",
  "search.noMatches": "一致なし",
  "search.subtitleUnassigned": "{layer} · 未割当",
  "search.untitledPoint": "名称未設定ポイント",

  // Sections
  "section.import": "インポート",
  "section.models": "3D モデル",
  "section.cityGml": "CityGML レイヤ",
  "section.basemap": "ベースマップ",
  "section.floors": "フロアレベル",
  "section.placement": "配置",
  "section.scene": "シーン",
  "section.environment": "環境",
  "section.importedLayers": "インポート済みレイヤ",

  // Left action bar / Add Data menu / settings popover
  "leftBar.addData": "+ データ追加",
  "leftBar.addData.title": "シーンにデータを追加",
  "leftBar.settings.title": "設定",
  "addData.url": "タイルセット URL…",
  "addData.folder": "タイルセットフォルダ…",
  "addData.cityGml": "CityGML (.gml)…",
  "addData.gdbZip": "ジオデータベース (.gdb.zip)…",
  "addData.gdbFolder": "ジオデータベースフォルダ…",
  "addData.shp": "Shapefile (.zip)…",
  "addData.gdbReassign": "GDB レイヤを再割り当て…",
  "addData.catalog": "PLATEAU カタログ…",
  "scene.filterPlaceholder": "シーン内を検索…",
  "scene.itemsCount": "{count} 件",
  "scene.itemsCountFiltered": "{filtered}/{total} 件",
  "scene.empty": "モデルがありません。+ データ追加をクリックしてください。",
  "settings.title": "設定",
  "dnd.tooltip": "ドラッグで再割り当て — 右クリックでメニュー",

  // Context menus (scene tree)
  "ctx.building.addLevel": "フロアを追加…",
  "ctx.building.setBaseElev": "基準高を設定…",
  "ctx.building.shiftTileset": "タイルセットを移動…",
  "ctx.level.editName": "名前を編集…",
  "ctx.level.editElev": "高さを編集…",
  "ctx.layer.adjustHeight": "高さを調整…",
  "ctx.layer.resetHeight": "高さオフセットをリセット",
  "ctx.layer.configureColors": "色を設定…",
  "ctx.layer.remove": "削除",

  // Color config modal
  "colorConfig.title": "レイヤの色を設定",
  "colorConfig.column": "列",
  "colorConfig.value": "値",
  "colorConfig.color": "色",
  "colorConfig.loadPalette": "パレットを読み込む",
  "colorConfig.savePalette": "パレットとして保存…",
  "colorConfig.savePalettePrompt": "パレット名",
  "colorConfig.resetDefaults": "デフォルトに戻す",
  "colorConfig.defaultPaletteName": "デフォルト",
  "colorConfig.customColor": "カスタム…",
  "colorConfig.apply": "適用",
  "colorConfig.cancel": "キャンセル",
  "colorConfig.overwritePalette": "「{name}」というパレットは既に存在します。上書きしますか？",
  "colorConfig.importJson": "JSON をインポート…",
  "colorConfig.exportJson": "JSON をエクスポート",
  "colorConfig.importInvalid": "パレットファイルを読み込めませんでした。Cesium レイヤカラーパレットの JSON 形式が必要です。",
  "colorConfig.importSaveToLibrary": "インポートしたパレット「{name}」をライブラリに保存しますか？",
  "colorConfig.noValues": "この列には個別の値が見つかりません。",
  "colorConfig.moreValuesNote": "他に {count} 件の値はデフォルト色で表示されます (200 行まで)。",

  // Per-layer height offset
  "layer.heightOffsetTitle": "このレイヤの高さオフセット (m)。レベル基準より上 (+) または下 (−) にずらします。",

  // Popover labels
  "popover.ok": "OK",
  "popover.cancel": "キャンセル",
  "popover.levelName": "名前",
  "popover.elevation": "高さ (m)",
  "popover.baseElevation": "基準高 (WGS84 m)",
  "popover.tilesetShift": "タイルセットの移動 (m)",
  "popover.layerHeight": "レイヤ高さオフセット (m)",

  // Import Data section (left panel)
  "import.button": "データをインポート…",
  "import.empty": "インポート済みレイヤはありません。",

  // 3D Models
  "models.urlPlaceholder": "タイルセット URL…",
  "models.loadUrl": "読み込み",
  "models.loadUrl.loading": "読み込み中...",
  "models.browse": "ファイルを選択…",
  "models.browse.loading": "読み込み中...",
  "models.browse.attaching": "再接続中…",
  "models.empty": "モデルが読み込まれていません。",
  "models.highestLodOnly": "最高 LOD のみ表示",
  "models.lodStatus": "{buildings} 棟を追跡、低 LOD の重複を {duplicates} 件非表示",

  // CityGML
  "cityGml.button": ".gml を読み込み…",
  "cityGml.button.loading": "読み込み中…",
  "cityGml.empty": "CityGML レイヤがありません。",

  // Basemap
  "basemap.tokenLabel": "Cesium Ion トークン",
  "basemap.tokenPlaceholder": "ここにトークンを貼り付け…",
  "basemap.applyToken": "適用",
  "basemap.imageryLabel": "画像",
  "basemap.terrainLabel": "地形",
  "imagery.osm": "OpenStreetMap",
  "imagery.bingAerial": "Bing 航空写真 (Ion)",
  "imagery.sentinel": "Sentinel-2 (Ion)",
  "imagery.esriStreet": "Esri World Street Map",
  "imagery.esriTopo": "Esri World Topo Map",
  "imagery.esriImagery": "Esri World Imagery",
  "imagery.esriLightGray": "Esri Light Gray Canvas",
  "imagery.cartoPositron": "CartoDB Positron",
  "terrain.flat": "平面(地形なし)",
  "terrain.cesiumWorld": "Cesium World Terrain (Ion)",
  "terrain.gsi5a": "日本 DEM 5A – GSI (無料)",
  "terrain.gsi5b": "日本 DEM 5B – GSI (無料)",
  "terrain.plateau": "PLATEAU 地形 (日本)",

  // Right panel — selection placeholder + header
  "right.noSelection": "3D モデルを選択して<br/>プロパティを編集",
  "right.zoomExtents.title": "全体表示",
  "right.removeModel.title": "モデルを削除",
  "right.reload.message": "モデルが読み込まれていません — フォルダを選択して復元してください。",
  "right.reload.button": "3D モデルを再読み込み…",
  "right.grant.message": "フォルダへのアクセスが必要です: {folder}",
  "right.grant.button": "アクセスを許可して再読み込み",

  // Floor Levels
  "level.namePlaceholder": "2F",
  "level.elevPlaceholder": "高さ (m)",
  "level.add": "追加",
  "level.baseElev": "基準高 (WGS84 m)",
  "level.allFloors": "全フロア",
  "level.removeTitle": "フロアを削除",
  "building.addShapefilesTitle": "この建物に Shapefile を追加",
  "building.addGdbTitle": "この建物に Esri ファイルジオデータベース (.gdb) を追加",
  "building.aliases.label": "別名",
  "building.aliases.placeholder": "カンマ区切り、例: Oazo, オアゾ",
  "building.aliases.help": "GDB レイヤのファイル名をこの建物に一致させるための別名。",

  // Shapefile Layers
  "shp.removeTitle": "Shapefile を削除",
  "shp.hide": "非表示",
  "shp.show": "表示",

  // Geodatabase (.gdb) Layers
  "gdb.pickZip": "ジオデータベース (.gdb.zip または .zip)…",
  "gdb.pickFolder": "ジオデータベースフォルダ…",
  "gdb.loading": "ジオデータベースを解析中…",
  "gdb.section.title": "ジオデータベース (.gdb)",

  // GDB インポート確認ダイアログ
  "gdb.dialog.title": "GDB レイヤをインポート",
  "gdb.dialog.subtitle": "{count} 件のレイヤが見つかりました。各レイヤの建物とフロアを確認し、インポートをクリックしてください。",
  "gdb.dialog.col.layer": "レイヤ",
  "gdb.dialog.col.match": "一致",
  "gdb.dialog.col.building": "建物",
  "gdb.dialog.col.floor": "フロア",
  "gdb.dialog.bulk.selectAll": "すべて選択",
  "gdb.dialog.bulk.applyBuilding": "選択した行の建物",
  "gdb.dialog.bulk.applyFloor": "選択した行のフロア",
  "gdb.dialog.bulk.markSkip": "選択した行をスキップ",
  "gdb.dialog.option.unassigned": "(未割当)",
  "gdb.dialog.option.skip": "(スキップ)",
  "gdb.dialog.option.allFloors": "全フロア",
  "gdb.dialog.option.choose": "—",
  "gdb.dialog.cancel": "キャンセル",
  "gdb.dialog.import": "インポート",
  "gdb.dialog.importSelected": "選択をインポート",
  "gdb.dialog.apply": "適用",
  "gdb.dialog.reassignTitle": "GDB レイヤを再割り当て",
  "gdb.dialog.reassignSubtitle": "{count} 件の既存 GDB レイヤがあります。移動、スキップ、または変更しない行を選択してください。",
  "gdb.dialog.filter.placeholder": "レイヤ名で絞り込み…",
  "gdb.reassign.button": "既存レイヤを再割り当て…",
  "gdb.reassign.empty": "再割り当て可能な GDB レイヤがありません。",
  "gdb.import.duplicatesSkipped": "既に存在する GDB レイヤ {count} 件をスキップしました。",
  "gdb.dialog.featureCount": "{count} 件 · {geom}",
  "gdb.dialog.geom.polygon": "ポリゴン",
  "gdb.dialog.geom.line": "ライン",
  "gdb.dialog.geom.point": "ポイント",
  "gdb.dialog.geom.mixed": "混在",
  "gdb.confidence.high": "高一致",
  "gdb.confidence.medium": "部分一致",
  "gdb.confidence.none": "名前一致なし",
  "gdb.dialog.floor.unresolvedTitle": "自動一致でフロアを特定できませんでした — 建物の基底位置にインポートされます。",
  "gdb.dialog.floor.perFeatureBadge": "(地物ごと、{count} フロア)",
  "gdb.dialog.floor.noFloor": "(フロアなし)",
  "gdb.dialog.floor.subRowCount": "{count} 件",
  "gdb.dialog.parentRowHint": "既定値を設定し、下のフロアを選択",
  "gdb.unassigned.groupName": "インポート済み（ドラッグして割当）",
  "gdb.unassigned.moveTitle": "建物へ移動",
  "ctx.layer.moveToFloor": "フロアへ移動",

  // Placement
  "placement.heightOffset": "高さオフセット (m)",

  // Building list
  "building.removeTitle": "建物を削除",
  "building.zoomTitle": "建物にズーム",
  "building.noModelBadge": "モデルなし",
  "building.allBadge": "全フロア",
  "building.chip.host": "ホスト",
  "building.chip.link": "リンク",

  // Imported layers list
  "layer.toggleTitle": "表示切替",
  "layer.removeTitle": "削除",

  // Generic
  "generic.remove": "削除",
  "generic.removeX": "×",

  // Panel toggles
  "panel.left.title": "左パネル切替",
  "panel.left.aria": "左パネルを折り畳む",
  "panel.right.title": "右パネル切替",
  "panel.right.aria": "右パネルを折り畳む",
  "panel.modelLevels": "モデルフロア",
  "panel.buildings": "建物",

  // Revit link split dialog
  "split.title": "複数の Revit リンクを検出しました",
  "split.bodyHtml":
    "このタイルセットには <strong><span id=\"splitGroupCount\">0</span></strong> 件のリンクされた Revit モデルが含まれています。建物ごとに分割しますか？",
  "split.split": "分割する",
  "split.merge": "統合のまま",
  "split.elements": "{count} 個",
  "split.confirmFallback":
    "{count} 件のリンクされた Revit モデルを検出しました。建物ごとに分割しますか？",
  "split.hostFallback": "ホスト",

  // Alerts
  "alert.failedLoad": "タイルセットの読み込みに失敗しました:\n{message}",
  "alert.failedShp": "Shapefile の解析に失敗しました:\n{message}",
  "alert.failedGdb": "ジオデータベースの解析に失敗しました:\n{message}",
  "alert.failedGml": "CityGML の読み込みに失敗しました:\n{message}",
  "alert.failedSession": "セッションの読み込みに失敗しました:\n{message}",
  "alert.nothingToSave": "保存する内容がありません。",

  // tilesetLoader
  "tileset.foundN": "{count} 個のファイルを検出。読み込み中...",
  "tileset.loaded": "読み込み完了: {path}",
  "tileset.noJson": "選択したフォルダに tileset.json が見つかりません。",
  "tileset.noPolygon": "この CityGML ファイルにはポリゴン形状が含まれていません。",

  // Import Data modal — header + actions
  "modal.title": "データをインポート",
  "modal.close": "閉じる",
  "modal.add": "追加",
  "modal.adding": "読み込み中…",
  "modal.free": "無料",
  "modal.learnMore": "詳しくはこちら",

  // Sources
  "sources.cat.vegetation": "植生",
  "sources.cat.buildings": "建物",
  "sources.cat.cityModel": "都市モデル",
  "sources.osmTrees.label": "OpenStreetMap 樹木",
  "sources.osmTrees.desc":
    "ボランティアが管理する無料のオープン地理データベース OpenStreetMap の植生データです。各樹木を地形に貼り付けた緑のポイントで描画します。",
  "sources.plateau.label": "PLATEAU 3D Tiles",
  "sources.plateau.desc":
    "国土交通省 (MLIT) の Project PLATEAU が公開する 3D 都市モデルデータセットです。エリアと読み込む地物カテゴリを選択してください。",
  "sources.osmBuildings.label": "OSM 建物",
  "sources.osmBuildings.desc":
    "OpenStreetMap の建物フットプリントを地形に貼り付けた平面ポリゴンとして描画します。日本以外の地域に適しています。",

  // PLATEAU options
  "plateau.areaLabel": "エリア:",
  "plateau.areaPlaceholder": "自治体を検索…",
  "plateau.areaRequired": "読み込む前に PLATEAU エリアを選択してください。",
  "plateau.areaNotFound": "一致する PLATEAU エリアがありません。",
  "plateau.areaStatus": "{source}: {area}",
  "plateau.areaFromModel": "読み込み済みモデルから検出",
  "plateau.areaFromCamera": "カメラ位置から検出",
  "plateau.areaFromMap": "地図範囲から検出",
  "plateau.areaManual": "選択中のエリア",
  "plateau.areaDetecting": "PLATEAU エリアを検出中…",
  "plateau.areaNotDetected": "この地図範囲では PLATEAU エリアを検出できませんでした。",
  "plateau.areaCount": "{count} エリア",
  "plateau.catalogLoading": "PLATEAU カタログを読み込み中…",
  "plateau.catalogError": "PLATEAU カタログを読み込めませんでした: {message}",
  "plateau.categoriesLabel": "カテゴリ",
  "plateau.noCategories": "カテゴリは未読み込みです。",
  "plateau.noCategoriesForArea": "このエリアの PLATEAU 3D Tiles カテゴリは見つかりません。",
  "plateau.selectCategoryRequired": "PLATEAU カテゴリを 1 つ以上選択してください。",
  "plateau.categoryMeta": "LOD {lod} · {texture}",
  "plateau.categoryAreaCount": "{count} エリア",
  "plateau.texturedOnly": "テクスチャ版のみ",
  "plateau.mixedTextures": "テクスチャ混在",
  "plateau.wardLabel": "区:",
  "plateau.lodLabel": "LOD:",
  "plateau.texturesLabel": "テクスチャ:",
  "plateau.textured": "テクスチャあり",
  "plateau.noTextures": "テクスチャなし",
  "plateau.lodOption": "LOD {n}",
  "plateau.feature.bldg": "建物",
  "plateau.feature.tran": "道路 / 交通",
  "plateau.feature.brid": "橋梁",
  "plateau.feature.veg": "植生",
  "plateau.feature.frn": "都市設備",
  "plateau.feature.luse": "土地利用",
  "plateau.feature.wtr": "水部",
  "plateau.feature.fld": "洪水浸水想定区域",
  "plateau.feature.tnm": "地形",
  "plateau.feature.urf": "都市計画",
  "plateau.feature.dem": "DEM",

  // Modal feedback
  "modal.areaTooLarge": "範囲が広すぎます ({area} km²)。上限: {cap} km²。",
  "modal.loadedFeatures": "{count} 件のフィーチャを読み込みました。",
  "modal.loadedLayers": "{count} 件のレイヤを読み込みました。",
  "modal.loadedLayersWithFailures": "{count} 件のレイヤを読み込みました。{failures} 件は失敗しました。",
  "modal.loadedOk": "読み込みに成功しました。",
  "modal.error": "エラー: {msg}",
  "modal.networkError": "ネットワークまたは CORS エラー",
  "modal.osmTreesLabel": "OSM 樹木 ({count})",
  "modal.osmBuildingsLabel": "OSM 建物 ({count})",
  "modal.plateauLayerLabel": "PLATEAU – {area} – {type} – LOD{lod} – {textureLabel}",
  "modal.plateauAllFailed": "選択した PLATEAU レイヤを読み込めませんでした。",
  "modal.textured": "テクスチャあり",
  "modal.notTextured": "テクスチャなし",
  "modal.areaUnknown": "—",
  "modal.areaPending": "…",
  "modal.areaKm2": "{area} km²",
  "modal.plateauNoData":
    "{ward} の LOD{lod} ({textureLabel}) に対応する PLATEAU 3D Tiles データセットが見つかりません。",
  "modal.plateauHasTextures": "テクスチャあり",
  "modal.plateauNoTextures": "テクスチャなし",

  // PLATEAU feature overrides
  "plateau.manualTitle": "PLATEAU フィーチャ",
  "plateau.noFeatureSelected": "PLATEAU フィーチャは未選択です。",
  "plateau.transparent": "透過",
  "plateau.hideFeature": "非表示",
  "plateau.visible": "表示",
  "plateau.overridesTitle": "手動設定",
  "plateau.clearAll": "すべて解除",
  "plateau.noOverrides": "手動設定はありません。",
  "plateau.mode.ghost": "透過",
  "plateau.mode.hidden": "非表示",

  // PLATEAU overlap
  "building.plateauOverlap": "重複する PLATEAU を透過表示",

  // Loading indicators
  "loading.session.title": "セッションを復元中…",
  "loading.session.progress": "{current} / {total} 件を読み込み中",
  "loading.plateau.progress": "{current} / {total} 件のレイヤを読み込み中…",
};

export const MESSAGES = { en, ja };
