// "Export view": render what the camera sees at a higher resolution than the
// window and save it as a PNG, plus named camera views and a camera lock so
// the same framing can be re-exported after changing settings.
//
// The image is the Cesium canvas only (no panels, cards or credits). It is
// rendered with viewer.resolutionScale raised, after waiting for tiles to
// refine at the new resolution; billboards and labels scale with it, so the
// result looks like the screen, just sharper.

import { Cartesian3, ContextLimits } from "cesium";

export const EXPORT_SCALES = [1, 2, 3, 4];
const DEFAULT_SCALE = 2;
const TILE_WAIT_TIMEOUT_MS = 60000;
// Tiles must report loaded for this many frames in a row before capturing.
const STABLE_FRAMES = 6;

// -- Pure helpers -----------------------------------------------------------

/** Largest image dimension the GPU can render into. */
export function maxRenderSize(limits = ContextLimits) {
  const renderbuffer = Number(limits?.maximumRenderbufferSize) || 8192;
  const viewport = Number(limits?.maximumViewportWidth) || renderbuffer;
  return Math.min(renderbuffer, viewport);
}

/**
 * Output size for a scale of the current view. `pixelRatio` is the device
 * pixel ratio Cesium already renders at.
 */
export function exportDimensions(cssWidth, cssHeight, scale, pixelRatio = 1) {
  return {
    width: Math.round(cssWidth * pixelRatio * scale),
    height: Math.round(cssHeight * pixelRatio * scale),
  };
}

/** Scales from EXPORT_SCALES that fit within the GPU's render size. */
export function availableScales(cssWidth, cssHeight, pixelRatio = 1, maxSize = 8192) {
  const fits = EXPORT_SCALES.filter((scale) => {
    const { width, height } = exportDimensions(cssWidth, cssHeight, scale, pixelRatio);
    return width <= maxSize && height <= maxSize;
  });
  return fits.length ? fits : [1];
}

export function exportFileName(baseName, viewName, width, height, date = new Date()) {
  const clean = (value) => String(value ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "_");
  const stamp = date.toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const parts = [clean(baseName) || "view", clean(viewName), `${width}x${height}`, stamp].filter(Boolean);
  return `${parts.join("_")}.png`;
}

/** Validated saved views: { id, name, position: [x,y,z], heading, pitch, roll }. */
export function normalizeSavedViews(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const view of raw) {
    const position = Array.isArray(view?.position) ? view.position.map(Number) : null;
    if (!position || position.length !== 3 || !position.every(Number.isFinite)) continue;
    const angle = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
    out.push({
      id: String(view.id || `view-${out.length + 1}`),
      name: String(view.name || `View ${out.length + 1}`).slice(0, 80),
      position,
      heading: angle(view.heading),
      pitch: angle(view.pitch),
      roll: angle(view.roll),
    });
  }
  return out;
}

export function captureCameraView(camera, name, id = `view-${Date.now().toString(36)}`) {
  const p = camera.positionWC;
  return { id, name, position: [p.x, p.y, p.z], heading: camera.heading, pitch: camera.pitch, roll: camera.roll };
}

export function applyCameraView(camera, view) {
  camera.setView({
    destination: new Cartesian3(...view.position),
    orientation: { heading: view.heading, pitch: view.pitch, roll: view.roll },
  });
}

// -- Rendering --------------------------------------------------------------

function tilesetsLoaded(scene) {
  const primitives = scene.primitives;
  for (let i = 0; i < primitives.length; i++) {
    const primitive = primitives.get(i);
    if (primitive?.show !== false && primitive?.tilesLoaded === false) return false;
  }
  return true;
}

function waitForDetail(scene, timeoutMs = TILE_WAIT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const started = performance.now();
    let stable = 0;
    const remove = scene.postRender.addEventListener(() => {
      const loaded = scene.globe.tilesLoaded && tilesetsLoaded(scene);
      stable = loaded ? stable + 1 : 0;
      if (stable >= STABLE_FRAMES || performance.now() - started > timeoutMs) {
        remove();
        resolve(stable >= STABLE_FRAMES);
      } else {
        scene.requestRender();
      }
    });
    scene.requestRender();
  });
}

function captureNextFrame(scene) {
  return new Promise((resolve, reject) => {
    const remove = scene.postRender.addEventListener(() => {
      remove();
      // Read the drawing buffer in the same task it was rendered in.
      scene.canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Canvas capture failed"))), "image/png");
    });
    scene.requestRender();
  });
}

/**
 * Render the current view `scale` times larger and return it as a PNG blob.
 * @returns {Promise<{ blob: Blob, width: number, height: number, complete: boolean }>}
 */
export async function renderViewImage(viewer, scale, { onStatus } = {}) {
  const { scene } = viewer;
  const previousScale = viewer.resolutionScale;
  try {
    viewer.resolutionScale = previousScale * scale;
    onStatus?.("loading");
    const complete = await waitForDetail(scene);
    onStatus?.("capturing");
    const blob = await captureNextFrame(scene);
    return { blob, width: scene.canvas.width, height: scene.canvas.height, complete };
  } finally {
    viewer.resolutionScale = previousScale;
    scene.requestRender();
  }
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// -- UI ---------------------------------------------------------------------

/**
 * Mount the toolbar button and panel.
 * @param {object} options
 * @param {import("cesium").Viewer} options.viewer
 * @param {(key: string, params?: object) => string} options.t
 * @param {() => string} [options.getFileBaseName] prefix for exported files
 * @param {(views: object[]) => void} [options.onViewsChanged] persist views
 * @param {(kind: string, key: string, params?: object) => void} [options.notify]
 */
export function createViewExportTool({ viewer, t, getFileBaseName = () => "view", onViewsChanged = () => {}, notify = () => {} }) {
  const { scene, camera } = viewer;
  let views = [];
  let scale = DEFAULT_SCALE;
  let locked = false;
  let busy = false;
  let status = "";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "cesium-button cesium-toolbar-button view-export-toolbar-btn";
  const toolbar = viewer.container.querySelector(".cesium-viewer-toolbar");
  toolbar?.prepend(button);

  const card = document.createElement("div");
  card.className = "floating-card view-export-card";
  card.hidden = true;
  document.body.appendChild(card);

  button.addEventListener("click", () => {
    card.hidden = !card.hidden;
    if (!card.hidden) render();
  });

  // Re-render the size readout when the window (and so the canvas) resizes.
  window.addEventListener("resize", () => {
    if (!card.hidden && !busy) render();
  });

  function setLocked(next) {
    locked = next;
    scene.screenSpaceCameraController.enableInputs = !locked;
    button.classList.toggle("active", locked);
    render();
  }

  function setViewsInternal(next, { persist = true } = {}) {
    views = normalizeSavedViews(next);
    if (persist) onViewsChanged(views.map((v) => ({ ...v })));
    render();
  }

  async function exportImage(viewName = "") {
    if (busy) return;
    busy = true;
    const size = currentSize();
    status = t("viewExport.rendering", size);
    render();
    try {
      const result = await renderViewImage(viewer, scale, {
        onStatus: (phase) => {
          status = t(phase === "loading" ? "viewExport.loadingDetail" : "viewExport.rendering", size);
          render();
        },
      });
      const fileName = exportFileName(getFileBaseName(), viewName, result.width, result.height);
      downloadBlob(result.blob, fileName);
      status = result.complete
        ? t("viewExport.done", { file: fileName })
        : t("viewExport.doneIncomplete", { file: fileName });
    } catch (e) {
      console.error(e);
      status = t("viewExport.failed", { message: e?.message ?? String(e) });
      notify("error", "viewExport.failed", { message: e?.message ?? String(e) });
    } finally {
      busy = false;
      render();
    }
  }

  function currentSize(forScale = scale) {
    const canvas = scene.canvas;
    return exportDimensions(canvas.clientWidth, canvas.clientHeight, forScale, canvas.width / Math.max(1, canvas.clientWidth));
  }

  function render() {
    button.title = t("viewExport.button");
    button.setAttribute("aria-label", t("viewExport.button"));
    if (card.hidden) return;
    card.innerHTML = "";

    const header = document.createElement("div");
    header.className = "card-header";
    header.textContent = t("viewExport.title");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "card-close-btn";
    close.textContent = "×";
    close.title = t("modal.close");
    close.addEventListener("click", () => { card.hidden = true; });
    card.append(header, close);

    // Size
    const canvas = scene.canvas;
    const pixelRatio = canvas.width / Math.max(1, canvas.clientWidth);
    const scales = availableScales(canvas.clientWidth, canvas.clientHeight, pixelRatio, maxRenderSize());
    if (!scales.includes(scale)) scale = scales[scales.length - 1];
    const sizeLabel = document.createElement("label");
    sizeLabel.className = "field-label";
    sizeLabel.textContent = t("viewExport.size");
    const sizeSelect = document.createElement("select");
    sizeSelect.className = "view-export-size";
    for (const s of scales) {
      const { width, height } = currentSize(s);
      sizeSelect.append(new Option(t("viewExport.scaleOption", { scale: s, width, height }), String(s)));
    }
    sizeSelect.value = String(scale);
    sizeSelect.disabled = busy;
    sizeSelect.addEventListener("change", () => { scale = Number(sizeSelect.value); });
    card.append(sizeLabel, sizeSelect);

    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.className = "primary-btn view-export-btn";
    exportBtn.textContent = busy ? t("viewExport.working") : t("viewExport.export");
    exportBtn.disabled = busy;
    exportBtn.addEventListener("click", () => exportImage());
    card.append(exportBtn);

    if (status) {
      const statusEl = document.createElement("p");
      statusEl.className = "view-export-status";
      statusEl.textContent = status;
      card.append(statusEl);
    }

    // Lock
    const lockRow = document.createElement("label");
    lockRow.className = "toggle-label view-export-lock";
    lockRow.title = t("viewExport.lockHint");
    const lockInput = document.createElement("input");
    lockInput.type = "checkbox";
    lockInput.checked = locked;
    lockInput.addEventListener("change", () => setLocked(lockInput.checked));
    const track = document.createElement("span");
    track.className = "toggle-track";
    track.innerHTML = '<span class="toggle-thumb"></span>';
    const lockText = document.createElement("span");
    lockText.textContent = t("viewExport.lock");
    lockRow.append(lockInput, track, lockText);
    card.append(lockRow);

    // Saved views
    const viewsTitle = document.createElement("div");
    viewsTitle.className = "view-export-subtitle";
    viewsTitle.textContent = t("viewExport.savedViews");
    card.append(viewsTitle);

    const saveRow = document.createElement("div");
    saveRow.className = "view-export-save-row";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = t("viewExport.defaultViewName", { n: views.length + 1 });
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "secondary-btn compact";
    saveBtn.textContent = t("viewExport.saveView");
    const save = () => {
      const name = nameInput.value.trim() || t("viewExport.defaultViewName", { n: views.length + 1 });
      setViewsInternal([...views, captureCameraView(camera, name)]);
    };
    saveBtn.addEventListener("click", save);
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
    saveRow.append(nameInput, saveBtn);
    card.append(saveRow);

    if (views.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-msg";
      empty.textContent = t("viewExport.noViews");
      card.append(empty);
    }
    const list = document.createElement("ul");
    list.className = "view-export-list";
    for (const view of views) {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.className = "view-export-view-name";
      name.textContent = view.name;
      name.title = view.name;
      const mk = (labelKey, onClick, title) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "secondary-btn compact";
        b.textContent = t(labelKey);
        if (title) b.title = title;
        b.disabled = busy;
        b.addEventListener("click", onClick);
        return b;
      };
      li.append(
        name,
        mk("viewExport.go", () => applyCameraView(camera, view)),
        mk("viewExport.exportView", () => { applyCameraView(camera, view); exportImage(view.name); }, t("viewExport.exportViewHint")),
        mk("viewExport.update", () => setViewsInternal(views.map((v) => (v.id === view.id ? captureCameraView(camera, v.name, v.id) : v))), t("viewExport.updateHint")),
        mk("viewExport.delete", () => setViewsInternal(views.filter((v) => v.id !== view.id))),
      );
      list.append(li);
    }
    card.append(list);
  }

  render();
  return {
    getViews: () => views.map((v) => ({ ...v })),
    setViews: (next) => setViewsInternal(next, { persist: false }),
    refreshLabels: render,
    get locked() { return locked; },
    setLocked,
  };
}

