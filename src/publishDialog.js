/**
 * Publish dialog: renders the pre-publish checklist and lets the user pick a
 * destination before anything is uploaded or downloaded. The actual work is
 * done by the handlers passed in (the same ones the header used to call
 * directly).
 */

import { t } from "./i18n.js";
import { computePublishChecklist } from "./publishChecklist.js";

const STATUS_ICONS = {
  ok: '<path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  warn: '<path d="M8 4v5M8 11.8v.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  block: '<path d="M5 5l6 6M11 5l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};

const ACTION_LABELS = {
  venues: "publish.check.action.venues",
  scene: "publish.check.action.scene",
};

/**
 * @param {object} opts
 * @param {HTMLDialogElement} opts.dialog
 * @param {() => {buildings, venues, unassignedLayers}} opts.getState
 * @param {{server: Function, viewer: Function, website: Function}} opts.handlers
 * @param {(action: string) => void} opts.onAction  "venues" | "scene"
 * @returns {{ open: () => void }}
 */
export function initPublishDialog({ dialog, getState, handlers, onAction }) {
  if (!dialog) return { open: () => {} };

  const list = dialog.querySelector("#publishChecklist");
  const venueEl = dialog.querySelector("#publishDialogVenue");
  const note = dialog.querySelector("#publishDialogNote");
  const confirmBtn = dialog.querySelector("#publishConfirmBtn");
  const confirmLabel = dialog.querySelector("#publishConfirmLabel");
  let checklist = { items: [], canPublish: false, hasWarnings: false };

  const destination = () =>
    dialog.querySelector('input[name="publishDestination"]:checked')?.value ?? "server";

  const renderFooter = () => {
    confirmLabel.textContent = t(destination() === "server" ? "publish.dialog.publish" : "publish.dialog.export");
    confirmBtn.disabled = !checklist.canPublish;
    note.textContent = !checklist.canPublish
      ? t("publish.dialog.blocked")
      : checklist.hasWarnings
        ? t("publish.dialog.warnNote")
        : "";
  };

  const render = () => {
    const state = getState();
    checklist = computePublishChecklist(state);

    const venueNames = (state.venues ?? [])
      .filter((v) => (state.buildings ?? []).some((b) => b.venueId === v.id))
      .map((v) => v.name);
    venueEl.textContent = venueNames.join(" · ");
    venueEl.hidden = venueNames.length === 0;

    list.textContent = "";
    for (const item of checklist.items) {
      const li = document.createElement("li");
      li.className = `publish-check-item status-${item.status}`;

      const icon = document.createElement("span");
      icon.className = "publish-check-icon";
      icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">${STATUS_ICONS[item.status]}</svg>`;

      const text = document.createElement("span");
      text.className = "publish-check-text";
      const title = document.createElement("span");
      title.className = "publish-check-title";
      title.textContent = t(`publish.check.${item.id}.title`);
      const detail = document.createElement("span");
      detail.className = "publish-check-detail";
      detail.textContent = t(item.key, item.params);
      text.append(title, detail);
      li.append(icon, text);

      if (item.action && ACTION_LABELS[item.action]) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "secondary-btn compact";
        btn.textContent = t(ACTION_LABELS[item.action]);
        btn.addEventListener("click", () => {
          dialog.close();
          onAction?.(item.action);
        });
        li.appendChild(btn);
      }
      list.appendChild(li);
    }
    renderFooter();
  };

  dialog.querySelectorAll('input[name="publishDestination"]').forEach((input) => {
    input.addEventListener("change", renderFooter);
  });
  dialog.querySelectorAll("[data-close-dialog]").forEach((btn) => {
    btn.addEventListener("click", () => dialog.close());
  });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });

  confirmBtn.addEventListener("click", () => {
    if (!checklist.canPublish) return;
    const run = handlers[destination()];
    dialog.close();
    run?.();
  });

  return {
    open() {
      render();
      if (!dialog.open) dialog.showModal();
    },
  };
}
