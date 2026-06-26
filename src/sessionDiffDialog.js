import { t } from "./i18n.js";
import { diffSessions } from "./sessionDiff.js";

let dialogEl = null;

function ensureDialog() {
  if (dialogEl) return dialogEl;
  dialogEl = document.createElement("dialog");
  dialogEl.id = "sessionDiffDialog";
  dialogEl.className = "modal-dialog";
  dialogEl.innerHTML = `
    <div class="modal-dialog-header">
      <h2 data-i18n="diff.title">Compare versions</h2>
      <button type="button" class="modal-close-btn" data-action="close" aria-label="Close">×</button>
    </div>
    <div class="modal-dialog-body">
      <div class="diff-pickers">
        <label><span data-i18n="diff.left">Left</span><select id="diffLeftSelect"></select></label>
        <label><span data-i18n="diff.right">Right</span><select id="diffRightSelect"></select></label>
        <button type="button" class="secondary-btn" id="diffCompareBtn" data-i18n="diff.compare">Compare</button>
      </div>
      <ul id="diffResultsList" class="diff-results"></ul>
      <p id="diffNoChanges" class="empty-msg" hidden data-i18n="diff.noChanges">No differences.</p>
    </div>
  `;
  document.body.appendChild(dialogEl);
  dialogEl.querySelector("[data-action=close]").addEventListener("click", () => dialogEl.close());
  dialogEl.addEventListener("click", (e) => {
    if (e.target === dialogEl) dialogEl.close();
  });
  return dialogEl;
}

function describeChange(change) {
  switch (change.category) {
    case "venues":
      if (change.type === "added") return t("diff.venueAdded", { name: change.name });
      if (change.type === "removed") return t("diff.venueRemoved", { name: change.name });
      if (change.type === "renamed") return t("diff.venueRenamed", { from: change.from, to: change.to });
      if (change.type === "descriptionChanged") return t("diff.venueDescription", { name: change.name });
      break;
    case "buildings":
      if (change.type === "added") return t("diff.buildingAdded", { name: change.name });
      if (change.type === "removed") return t("diff.buildingRemoved", { name: change.name });
      if (change.type === "venueMoved") {
        return t("diff.buildingMoved", {
          name: change.name,
          from: change.fromVenue ?? t("venue.unassigned"),
          to: change.toVenue ?? t("venue.unassigned"),
        });
      }
      break;
    case "levels":
      return t("diff.levelsChanged", { building: change.building, detail: change.detail });
    case "layers":
      if (change.type === "added") return t("diff.layerAdded", { building: change.building, name: change.name });
      if (change.type === "removed") return t("diff.layerRemoved", { building: change.building, name: change.name });
      break;
    case "settings":
      return t("diff.settingChanged", { field: change.field, from: change.from, to: change.to });
  }
  return JSON.stringify(change);
}

function fillSelect(select, backups, getCurrentSession) {
  select.innerHTML = "";
  const currentOpt = document.createElement("option");
  currentOpt.value = "__current__";
  currentOpt.textContent = t("diff.current");
  select.appendChild(currentOpt);
  for (const b of backups) {
    const opt = document.createElement("option");
    opt.value = b.id;
    const label = b.label || new Date(b.createdAt).toLocaleString();
    opt.textContent = label;
    select.appendChild(opt);
  }
  void getCurrentSession;
}

function resolveSession(id, backups, getCurrentSession) {
  if (id === "__current__") return getCurrentSession();
  return backups.find((b) => b.id === id)?.session ?? null;
}

export function openSessionDiffDialog({ backups, getCurrentSession, initialLeftId = null, initialRightId = "__current__" }) {
  const dialog = ensureDialog();
  const leftSelect = dialog.querySelector("#diffLeftSelect");
  const rightSelect = dialog.querySelector("#diffRightSelect");
  const resultsEl = dialog.querySelector("#diffResultsList");
  const noChangesEl = dialog.querySelector("#diffNoChanges");

  fillSelect(leftSelect, backups, getCurrentSession);
  fillSelect(rightSelect, backups, getCurrentSession);
  if (initialLeftId) leftSelect.value = initialLeftId;
  if (initialRightId) rightSelect.value = initialRightId;

  const runCompare = () => {
    const before = resolveSession(leftSelect.value, backups, getCurrentSession);
    const after = resolveSession(rightSelect.value, backups, getCurrentSession);
    const changes = diffSessions(before, after);
    resultsEl.innerHTML = "";
    noChangesEl.hidden = changes.length > 0;
    for (const change of changes) {
      const li = document.createElement("li");
      li.className = `diff-item diff-${change.type}`;
      li.dataset.category = change.category;
      li.textContent = describeChange(change);
      resultsEl.appendChild(li);
    }
  };

  dialog.querySelector("#diffCompareBtn").onclick = runCompare;
  runCompare();
  dialog.showModal();
}