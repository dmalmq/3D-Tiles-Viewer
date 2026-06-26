import { t } from "./i18n.js";

let dialogEl = null;

function ensureDialog() {
  if (dialogEl) return dialogEl;
  dialogEl = document.createElement("dialog");
  dialogEl.id = "publishLinksDialog";
  dialogEl.className = "modal-dialog";
  dialogEl.innerHTML = `
    <div class="modal-dialog-header">
      <h2 data-i18n="publish.title">Published — share these links</h2>
      <button type="button" class="modal-close-btn" data-action="close" aria-label="Close">×</button>
    </div>
    <div class="modal-dialog-body">
      <p id="publishWarnings" class="status-text" hidden></p>
      <div class="publish-link-block">
        <label data-i18n="publish.linkAll">All venues</label>
        <div class="publish-link-row">
          <input type="text" id="publishLinkAll" readonly />
          <button type="button" class="secondary-btn" data-copy="all" data-i18n="publish.copyLink">Copy</button>
        </div>
      </div>
      <ul id="publishVenueLinks" class="publish-venue-links"></ul>
      <p id="publishTilesetSummary" class="publish-tileset-note" hidden></p>
      <p class="publish-tileset-note" data-i18n="publish.tilesetNote">Open the viewer link in your browser (use the same host as the editor in dev).</p>
    </div>
  `;
  document.body.appendChild(dialogEl);
  dialogEl.querySelector("[data-action=close]").addEventListener("click", () => dialogEl.close());
  dialogEl.addEventListener("click", (e) => {
    if (e.target === dialogEl) dialogEl.close();
  });
  return dialogEl;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function openPublishLinksDialog({ links, warnings = [] }) {
  const dialog = ensureDialog();
  const allInput = dialog.querySelector("#publishLinkAll");
  const list = dialog.querySelector("#publishVenueLinks");
  const warnEl = dialog.querySelector("#publishWarnings");
  const tilesetSummary = dialog.querySelector("#publishTilesetSummary");

  allInput.value = links?.viewer ?? "";

  const tilesetCount = links?.tilesetCount ?? Object.keys(links?.tilesets ?? {}).length;
  if (tilesetCount > 0) {
    tilesetSummary.hidden = false;
    tilesetSummary.textContent = t("publish.tilesetSummary", { count: tilesetCount });
  } else {
    tilesetSummary.hidden = true;
    tilesetSummary.textContent = "";
  }

  if (warnings.length > 0) {
    warnEl.hidden = false;
    warnEl.textContent = warnings
      .map((w) => t(`publish.warn.${w.reason}`, { building: w.building, detail: w.detail ?? "" }))
      .join(" ");
  } else {
    warnEl.hidden = true;
    warnEl.textContent = "";
  }

  list.innerHTML = "";
  for (const venue of links?.venues ?? []) {
    const li = document.createElement("li");
    li.className = "publish-venue-link-row";
    const label = document.createElement("span");
    label.textContent = venue.name;
    const input = document.createElement("input");
    input.type = "text";
    input.readOnly = true;
    input.value = venue.url;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "secondary-btn";
    btn.textContent = t("publish.copyLink");
    btn.addEventListener("click", () => copyText(venue.url));
    li.append(label, input, btn);
    list.appendChild(li);
  }

  dialog.querySelector("[data-copy=all]").onclick = () => copyText(allInput.value);
  dialog.showModal();
}