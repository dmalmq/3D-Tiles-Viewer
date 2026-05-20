// Per-layer color config modal.
//
// Lets the user pick a GeoJSON property column and map distinct values to
// colors. Mappings can be loaded from / saved to a named-palette library in
// localStorage, or imported / exported as portable JSON files.

import { t, onLanguageChange } from "./i18n.js";
import { getLayerColumnNames, HEX_COLOR_RE } from "./layerColorConfig.js";

const PALETTE_STORAGE_KEY = "spaceColorPalettes";
const PALETTE_FILE_TYPE = "cesium-layer-color-palette";
const LEGACY_PALETTE_FILE_TYPE = "cesium-space-color-palette";
const MAX_ROWS = 200;
const DISTINCT_SCAN_CAP = 5000;

export function openColorConfigDialog({
  layer,
  defaultColumn,
  defaultMappings,
  defaultSwatches,
  onApply,
}) {
  const dialog = document.getElementById("colorConfigDialog");
  if (!dialog) return;

  // De-dupe and freeze the swatch palette for the picker popover.
  const swatches = [...new Set((defaultSwatches ?? []).map((h) => h.toUpperCase()))];

  // Mutable modal state.
  const columns = getLayerColumnNames(layer);
  if (defaultColumn && !columns.includes(defaultColumn)) columns.unshift(defaultColumn);
  let column = layer.colorColumn || defaultColumn || columns[0] || "color2";
  if (!columns.includes(column)) columns.unshift(column);
  let mappings = { ...(layer.colorMappings || (column === defaultColumn ? (defaultMappings ?? {}) : {})) };

  let openPopover = null;
  let unsubscribeLang = null;

  function render() {
    dialog.innerHTML = "";
    const body = el("div", "color-config-body");

    // Header: title + column picker.
    const header = el("div", "color-config-header");
    const h3 = el("h3", null, t("colorConfig.title"));
    header.appendChild(h3);
    const columnRow = el("div", "color-config-column-row");
    columnRow.appendChild(el("span", null, t("colorConfig.column") + ":"));
    const select = document.createElement("select");
    for (const c of columns) {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      if (c === column) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => {
      column = select.value;
      // Manually choosing a different driver column drops prior mappings —
      // they were keyed on the previous column's value space. Switching to the
      // canonical default column repopulates with the built-in palette.
      mappings = column === defaultColumn ? { ...(defaultMappings ?? {}) } : {};
      render();
    });
    columnRow.appendChild(select);
    header.appendChild(columnRow);
    body.appendChild(header);

    // Value list (distinct values in chosen column, plus any extra mapping keys).
    const list = el("div", "color-config-list");
    const distinct = distinctValuesForColumn(layer, column);
    // Auto-populate: if a column value is itself a hex code (e.g. previcolor =
    // "#979797"), use the value as its own color unless the user already chose
    // a different one. Lets hex-coded columns work with zero configuration.
    for (const v of distinct) {
      if (!mappings[v] && HEX_COLOR_RE.test(v)) {
        mappings[v] = v.toUpperCase();
      }
    }
    // Merge in any value present in mappings but not in the data (e.g. loaded
    // palette has a key the current layer doesn't use — keep it visible/editable).
    for (const k of Object.keys(mappings)) {
      if (!distinct.includes(k)) distinct.push(k);
    }

    if (distinct.length === 0) {
      list.appendChild(el("div", "color-config-empty-note", t("colorConfig.noValues")));
    } else {
      const visible = distinct.slice(0, MAX_ROWS);
      for (const val of visible) {
        list.appendChild(buildValueRow(val));
      }
      if (distinct.length > MAX_ROWS) {
        list.appendChild(
          el(
            "div",
            "color-config-more-note",
            t("colorConfig.moreValuesNote", { count: distinct.length - MAX_ROWS })
          )
        );
      }
    }
    body.appendChild(list);

    // Palette controls.
    const paletteBar = el("div", "color-config-palette-bar");
    paletteBar.appendChild(buildLoadPaletteButton());
    paletteBar.appendChild(buildButton(t("colorConfig.savePalette"), savePaletteFlow));
    paletteBar.appendChild(buildButton(t("colorConfig.importJson"), importJsonFlow));
    paletteBar.appendChild(buildButton(t("colorConfig.exportJson"), exportJsonFlow));
    paletteBar.appendChild(
      buildButton(t("colorConfig.resetDefaults"), () => {
        column = defaultColumn || "color2";
        mappings = { ...(defaultMappings ?? {}) };
        render();
      })
    );
    body.appendChild(paletteBar);

    // Footer.
    const footer = el("div", "color-config-footer");
    footer.appendChild(
      buildButton(t("colorConfig.cancel"), close, "secondary-btn")
    );
    footer.appendChild(
      buildButton(
        t("colorConfig.apply"),
        () => {
          onApply?.({ column, mappings: { ...mappings } });
          close();
        },
        "primary-btn"
      )
    );
    body.appendChild(footer);

    dialog.appendChild(body);
  }

  function buildValueRow(value) {
    const row = el("div", "color-config-row");
    const label = el("span", "value-label", value === "" ? "(empty)" : value);
    label.title = value;
    row.appendChild(label);
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "color-config-swatch";
    swatch.setAttribute("aria-label", t("colorConfig.color"));
    const currentHex = mappings[value] || "#808080";
    swatch.style.background = currentHex;
    swatch.addEventListener("click", (e) => {
      e.stopPropagation();
      openSwatchPicker(swatch, value);
    });
    row.appendChild(swatch);
    return row;
  }

  function openSwatchPicker(anchor, value) {
    closePopover();
    const pop = el("div", "color-config-palette-popover");
    const grid = el("div", "color-config-grid");
    for (const hex of swatches) {
      const sw = document.createElement("button");
      sw.type = "button";
      sw.className = "color-config-swatch";
      sw.style.background = hex;
      sw.title = hex;
      sw.addEventListener("click", () => {
        mappings[value] = hex;
        closePopover();
        render();
      });
      grid.appendChild(sw);
    }
    pop.appendChild(grid);
    const customRow = el("div", "color-config-custom-row");
    customRow.appendChild(el("span", null, t("colorConfig.customColor")));
    const input = document.createElement("input");
    input.type = "color";
    input.value = normalizeHex(mappings[value] || "#808080");
    input.addEventListener("change", () => {
      mappings[value] = input.value.toUpperCase();
      closePopover();
      render();
    });
    customRow.appendChild(input);
    pop.appendChild(customRow);

    dialog.appendChild(pop);
    positionPopover(pop, anchor);
    openPopover = pop;
    const closeOnOutside = (ev) => {
      if (!pop.contains(ev.target)) {
        closePopover();
        document.removeEventListener("mousedown", closeOnOutside, true);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", closeOnOutside, true), 0);
  }

  function closePopover() {
    if (openPopover) {
      openPopover.remove();
      openPopover = null;
    }
  }

  function buildLoadPaletteButton() {
    const wrap = document.createElement("span");
    const btn = buildButton(t("colorConfig.loadPalette"), (e) => {
      e.stopPropagation();
      showLoadMenu(btn);
    });
    wrap.appendChild(btn);
    return wrap;
  }

  function showLoadMenu(anchor) {
    closePopover();
    const pop = el("div", "color-config-palette-popover");
    const items = [
      { name: t("colorConfig.defaultPaletteName"), column: defaultColumn || "color2", mappings: defaultMappings ?? {} },
      ...readPaletteLibrary(),
    ];
    for (const p of items) {
      const li = document.createElement("button");
      li.type = "button";
      li.style.display = "block";
      li.style.width = "100%";
      li.style.textAlign = "left";
      li.style.padding = "4px 8px";
      li.style.background = "transparent";
      li.style.color = "inherit";
      li.style.border = "none";
      li.style.fontSize = "12px";
      li.style.cursor = "pointer";
      li.textContent = p.name;
      li.addEventListener("mouseenter", () => (li.style.background = "rgba(255,255,255,0.06)"));
      li.addEventListener("mouseleave", () => (li.style.background = "transparent"));
      li.addEventListener("click", () => {
        column = p.column;
        if (!columns.includes(column)) columns.unshift(column);
        mappings = { ...p.mappings };
        closePopover();
        render();
      });
      pop.appendChild(li);
    }
    dialog.appendChild(pop);
    positionPopover(pop, anchor);
    openPopover = pop;
    const closeOnOutside = (ev) => {
      if (!pop.contains(ev.target)) {
        closePopover();
        document.removeEventListener("mousedown", closeOnOutside, true);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", closeOnOutside, true), 0);
  }

  function savePaletteFlow() {
    const name = prompt(t("colorConfig.savePalettePrompt"));
    if (!name) return;
    const library = readPaletteLibrary();
    const existingIdx = library.findIndex((p) => p.name === name);
    if (existingIdx >= 0) {
      if (!confirm(t("colorConfig.overwritePalette", { name }))) return;
      library[existingIdx] = { name, column, mappings: { ...mappings } };
    } else {
      library.push({ name, column, mappings: { ...mappings } });
    }
    writePaletteLibrary(library);
  }

  function exportJsonFlow() {
    const name = layer.name || "palette";
    const payload = {
      type: PALETTE_FILE_TYPE,
      version: 1,
      name,
      column,
      mappings: { ...mappings },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(name)}-palette.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function importJsonFlow() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const palette = validatePalettePayload(parsed);
        if (!palette) {
          showToast(t("colorConfig.importInvalid"), { error: true });
          return;
        }
        column = palette.column;
        if (!columns.includes(column)) columns.unshift(column);
        mappings = { ...palette.mappings };
        render();
        // Offer to persist into the library so future sessions can find it.
        showToast(t("colorConfig.importSaveToLibrary", { name: palette.name }), {
          actionLabel: t("colorConfig.savePalette"),
          onAction: () => {
            const library = readPaletteLibrary();
            const existingIdx = library.findIndex((p) => p.name === palette.name);
            if (existingIdx >= 0) {
              if (!confirm(t("colorConfig.overwritePalette", { name: palette.name }))) return;
              library[existingIdx] = palette;
            } else {
              library.push(palette);
            }
            writePaletteLibrary(library);
          },
        });
      } catch {
        showToast(t("colorConfig.importInvalid"), { error: true });
      }
    });
    input.click();
  }

  function close() {
    closePopover();
    if (unsubscribeLang) unsubscribeLang();
    unsubscribeLang = null;
    if (dialog.open) dialog.close();
  }

  // Wire up open + close-on-Esc + re-render on language flip.
  render();
  unsubscribeLang = onLanguageChange(render);
  dialog.addEventListener("cancel", close, { once: true });
  dialog.showModal();
}

// ---- helpers ----

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function buildButton(label, onClick, className) {
  const b = document.createElement("button");
  b.type = "button";
  if (className) b.className = className;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function distinctValuesForColumn(layer, column) {
  const out = new Set();
  const feats = layer?.features ?? [];
  const n = Math.min(feats.length, DISTINCT_SCAN_CAP);
  for (let i = 0; i < n; i++) {
    const v = feats[i]?.properties?.[column];
    if (v == null) continue;
    out.add(String(v));
  }
  return [...out].sort();
}

function positionPopover(pop, anchor) {
  const rect = anchor.getBoundingClientRect();
  const popRect = pop.getBoundingClientRect();
  let top = rect.bottom + 4;
  let left = rect.left;
  if (top + popRect.height > window.innerHeight) {
    top = Math.max(8, rect.top - popRect.height - 4);
  }
  if (left + popRect.width > window.innerWidth) {
    left = Math.max(8, window.innerWidth - popRect.width - 8);
  }
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;
}

function readPaletteLibrary() {
  try {
    const raw = localStorage.getItem(PALETTE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p) =>
        p &&
        typeof p.name === "string" &&
        typeof p.column === "string" &&
        p.mappings &&
        typeof p.mappings === "object"
    );
  } catch {
    return [];
  }
}

function writePaletteLibrary(library) {
  try {
    localStorage.setItem(PALETTE_STORAGE_KEY, JSON.stringify(library));
  } catch (e) {
    console.warn("palette library save failed:", e);
  }
}

function validatePalettePayload(p) {
  if (!p || (p.type !== PALETTE_FILE_TYPE && p.type !== LEGACY_PALETTE_FILE_TYPE)) return null;
  if (typeof p.column !== "string" || !p.column) return null;
  if (!p.mappings || typeof p.mappings !== "object") return null;
  const cleaned = {};
  for (const [k, v] of Object.entries(p.mappings)) {
    if (typeof v !== "string" || !HEX_COLOR_RE.test(v)) return null;
    cleaned[String(k)] = v.toUpperCase();
  }
  return {
    name: typeof p.name === "string" && p.name ? p.name : "Imported",
    column: p.column,
    mappings: cleaned,
  };
}

function normalizeHex(hex) {
  // <input type="color"> requires 6-digit lowercase. Expand 3-digit if needed.
  if (!HEX_COLOR_RE.test(hex)) return "#808080";
  if (hex.length === 4) {
    return (
      "#" +
      hex[1] + hex[1] +
      hex[2] + hex[2] +
      hex[3] + hex[3]
    ).toLowerCase();
  }
  return hex.toLowerCase();
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "palette";
}

let _toastTimer = null;
function showToast(message, opts = {}) {
  const existing = document.querySelector(".color-config-toast");
  if (existing) existing.remove();
  if (_toastTimer) clearTimeout(_toastTimer);
  const toast = el("div", "color-config-toast" + (opts.error ? " error" : ""), message);
  if (opts.actionLabel && opts.onAction) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = opts.actionLabel;
    btn.addEventListener("click", () => {
      opts.onAction();
      toast.remove();
    });
    toast.appendChild(btn);
  }
  document.body.appendChild(toast);
  _toastTimer = setTimeout(() => toast.remove(), opts.error ? 5000 : 6000);
}
