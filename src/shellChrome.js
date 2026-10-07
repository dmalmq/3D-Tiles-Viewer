/**
 * Editor shell chrome: the header "More" menu, the Load → Author → Venue →
 * Publish stepper, the venue/building breadcrumb, the search shortcut and the
 * collapsible map-style picker over the viewport.
 *
 * Everything here only drives existing controls (buttons, the imagery
 * <select>) so the import/publish logic in main.js stays the single source of
 * truth.
 */

import { t } from "./i18n.js";

export { computeBreadcrumb, computeWorkflowState, WORKFLOW_STEPS } from "./workflowState.js";

export function renderWorkflowStepper(root, state) {
  if (!root) return;
  root.querySelectorAll(".workflow-step").forEach((btn) => {
    const step = btn.dataset.step;
    const isDone = !!state.done[step];
    btn.classList.toggle("done", isDone);
    if (step === state.current) btn.setAttribute("aria-current", "step");
    else btn.removeAttribute("aria-current");
    const label = btn.querySelector("[data-i18n]")?.textContent ?? step;
    btn.setAttribute("aria-label", isDone ? t("workflow.done", { step: label }) : label);
  });
}

export function renderBreadcrumb({ venueEl, buildingEl }, crumbs) {
  if (venueEl) venueEl.textContent = crumbs.venue ?? t("header.allVenues");
  if (buildingEl) buildingEl.textContent = crumbs.building ?? t("viewer.allBuildings");
}

/** Wires a button that toggles a floating menu placed under it. */
export function initHeaderMenu(button, menu) {
  if (!button || !menu) return;
  const close = () => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  const open = () => {
    const rect = button.getBoundingClientRect();
    menu.hidden = false;
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.left = `${Math.max(8, rect.right - menu.offsetWidth)}px`;
    button.setAttribute("aria-expanded", "true");
    menu.querySelector("button:not([disabled])")?.focus();
  };
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.hidden) open();
    else close();
  });
  // Items keep their own click handlers; the menu just closes afterwards.
  menu.addEventListener("click", (e) => {
    if (e.target.closest("button")) close();
  });
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !button.contains(e.target)) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) {
      close();
      button.focus();
    }
  });
}

/** "/" or Ctrl/Cmd+K focuses the header search unless the user is typing. */
export function initSearchShortcut(input) {
  if (!input) return;
  document.addEventListener("keydown", (e) => {
    const target = e.target;
    const typing = target instanceof HTMLElement &&
      (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    const isSlash = e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey;
    const isCmdK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k";
    if ((isSlash && !typing) || isCmdK) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}

// Flat preview colours for each imagery choice in the map-style picker.
const MAP_SWATCHES = {
  "carto-positron": "linear-gradient(135deg, #eceff3 0 60%, #ffffff 60% 66%, #dfe5ec 66%)",
  osm: "linear-gradient(135deg, #f2efe9 0 55%, #fcd6a4 55% 61%, #d4e6c8 61%)",
  "esri-street": "linear-gradient(135deg, #efe9df 0 55%, #ffffff 55% 61%, #f7d78f 61%)",
  "esri-topo": "linear-gradient(135deg, #e7dcc4 0 50%, #cfdcae 50% 75%, #b9cfe6 75%)",
  "esri-light-gray": "linear-gradient(135deg, #e6e7e8 0 60%, #f6f6f6 60% 66%, #d9dadb 66%)",
  "esri-imagery": "linear-gradient(135deg, #3f4a37 0 45%, #59614b 45% 70%, #2f3a4a 70%)",
  "ion-bing-aerial": "linear-gradient(135deg, #4b5a3e 0 45%, #6b6a55 45% 70%, #34404d 70%)",
  "ion-sentinel": "linear-gradient(135deg, #56603f 0 50%, #7b7356 50% 75%, #3b4b5c 75%)",
};
const FALLBACK_SWATCH = "linear-gradient(135deg, #d9dde3, #b9c0cb)";

/**
 * Collapsible map-style picker. Shows only the current map until opened;
 * choosing a style sets the imagery <select> and fires its change event so
 * the existing imagery switching runs. Returns sync(), to call whenever the
 * select changes programmatically (e.g. session restore).
 */
export function initMapStylePicker({ root, toggle, options, swatch, nameEl, select }) {
  if (!root || !toggle || !options || !select) return () => {};

  const setOpen = (open) => {
    options.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    root.classList.toggle("open", open);
  };

  const sync = () => {
    const opt = select.selectedOptions[0];
    const name = opt?.textContent?.trim() ?? "";
    if (swatch) swatch.style.background = MAP_SWATCHES[select.value] ?? FALLBACK_SWATCH;
    if (nameEl) nameEl.textContent = name;
    toggle.setAttribute("aria-label", t("map.picker.aria", { name }));
    options.querySelectorAll("[role=radio]").forEach((btn) => {
      btn.setAttribute("aria-checked", String(btn.dataset.value === select.value));
      const label = btn.querySelector(".map-style-option-name");
      const source = [...select.options].find((o) => o.value === btn.dataset.value);
      if (label && source) label.textContent = source.textContent.trim();
    });
  };

  const build = () => {
    options.textContent = "";
    for (const opt of select.options) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "map-style-option";
      btn.setAttribute("role", "radio");
      btn.dataset.value = opt.value;
      const sw = document.createElement("span");
      sw.className = "map-style-option-swatch";
      sw.style.background = MAP_SWATCHES[opt.value] ?? FALLBACK_SWATCH;
      const label = document.createElement("span");
      label.className = "map-style-option-name";
      label.textContent = opt.textContent.trim();
      btn.append(sw, label);
      btn.addEventListener("click", () => {
        if (select.value !== opt.value) {
          select.value = opt.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        setOpen(false);
        sync();
        toggle.focus();
      });
      options.appendChild(btn);
    }
  };

  build();
  setOpen(false);
  sync();

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(options.hidden);
  });
  select.addEventListener("change", sync);
  document.addEventListener("click", (e) => {
    if (!options.hidden && !root.contains(e.target)) setOpen(false);
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !options.hidden) {
      setOpen(false);
      toggle.focus();
    }
  });

  return sync;
}
