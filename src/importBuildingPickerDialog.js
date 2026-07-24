// Checklist dialog for at-import building selection. DOM + i18n live here so
// the grouping logic in importBuildingPicker.js stays unit-testable under node.

import { t } from "./i18n.js";

/**
 * Checklist dialog: pick which detected buildings to load. Resolves with the
 * selected keys, or null when the user cancels. Skip calling this when
 * enumerateBuildings returns fewer than two groups.
 */
export function openBuildingPickerDialog(groups) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "building-picker-overlay";

    const dialog = document.createElement("div");
    dialog.className = "building-picker-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");

    const title = document.createElement("h3");
    title.textContent = t("buildingPicker.title");
    dialog.appendChild(title);

    const hint = document.createElement("p");
    hint.className = "building-picker-hint";
    hint.textContent = t("buildingPicker.hint");
    dialog.appendChild(hint);

    const list = document.createElement("div");
    list.className = "building-picker-list";
    const checkboxes = new Map();
    for (const group of groups) {
      const row = document.createElement("label");
      row.className = "building-picker-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = true;
      checkboxes.set(group.key, cb);
      const text = document.createElement("span");
      text.textContent = `${group.label} — ${t("buildingPicker.counts", {
        layers: group.layerCount,
        features: group.featureCount,
      })}`;
      row.appendChild(cb);
      row.appendChild(text);
      list.appendChild(row);
    }
    dialog.appendChild(list);

    const toggleAll = document.createElement("button");
    toggleAll.type = "button";
    toggleAll.className = "building-picker-toggle-all";
    toggleAll.textContent = t("buildingPicker.toggleAll");
    toggleAll.addEventListener("click", () => {
      const allChecked = [...checkboxes.values()].every((cb) => cb.checked);
      for (const cb of checkboxes.values()) cb.checked = !allChecked;
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "building-picker-cancel";
    cancelBtn.textContent = t("buildingPicker.cancel");

    const importBtn = document.createElement("button");
    importBtn.type = "button";
    importBtn.className = "building-picker-import";
    importBtn.textContent = t("buildingPicker.import");

    const footer = document.createElement("div");
    footer.className = "building-picker-footer";
    footer.appendChild(toggleAll);
    footer.appendChild(cancelBtn);
    footer.appendChild(importBtn);
    dialog.appendChild(footer);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const close = (result) => {
      overlay.remove();
      document.removeEventListener("keydown", onKeydown);
      resolve(result);
    };
    const onKeydown = (e) => {
      if (e.key === "Escape") close(null);
    };
    document.addEventListener("keydown", onKeydown);

    cancelBtn.addEventListener("click", () => close(null));
    importBtn.addEventListener("click", () => {
      const keys = [...checkboxes.entries()].filter(([, cb]) => cb.checked).map(([key]) => key);
      close(keys);
    });
  });
}
