import { t } from "./i18n.js";

let dialogEl = null;

function ensureDialog() {
  if (dialogEl) return dialogEl;
  dialogEl = document.createElement("dialog");
  dialogEl.id = "publishLinksDialog";
  dialogEl.className = "app-dialog publish-links-dialog";
  dialogEl.setAttribute("aria-labelledby", "publishLinksTitle");
  dialogEl.innerHTML = `
    <div class="app-dialog-head">
      <span class="publish-success-icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
      <div>
        <h2 id="publishLinksTitle" class="app-dialog-title"></h2>
        <p class="app-dialog-subtitle"></p>
      </div>
      <button type="button" class="app-dialog-close" data-action="close"></button>
    </div>
    <div class="publish-links-body">
      <p id="publishWarnings" class="publish-links-warning" hidden></p>
      <ul id="publishVenueLinks" class="publish-venue-links"></ul>
      <div class="publish-link-block">
        <label for="publishLinkAll" data-i18n="publish.linkAll">All venues</label>
        <div class="publish-link-row">
          <input type="text" id="publishLinkAll" readonly />
          <button type="button" class="secondary-btn" data-copy="all" data-i18n="publish.copyLink">Copy</button>
        </div>
      </div>
      <p id="publishTilesetSummary" class="publish-tileset-note" hidden></p>
      <p class="publish-tileset-note" data-i18n="publish.tilesetNote">Open the viewer link in your browser (use the same host as the editor in dev).</p>
    </div>
  `;
  const closeBtn = dialogEl.querySelector("[data-action=close]");
  closeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
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

// Copies the link and briefly confirms on the button itself.
async function copyWithFeedback(button, text) {
  if (!(await copyText(text))) return;
  button.textContent = t("publish.copied");
  button.classList.add("copied");
  setTimeout(() => {
    button.textContent = t("publish.copyLink");
    button.classList.remove("copied");
  }, 1500);
}

export function openPublishLinksDialog({ links, warnings = [] }) {
  const dialog = ensureDialog();
  const allInput = dialog.querySelector("#publishLinkAll");
  const list = dialog.querySelector("#publishVenueLinks");
  const warnEl = dialog.querySelector("#publishWarnings");
  const tilesetSummary = dialog.querySelector("#publishTilesetSummary");
  dialog.querySelector("#publishLinksTitle").textContent = t("publish.published");
  dialog.querySelector(".app-dialog-subtitle").textContent = t("publish.shareLinks");
  dialog.querySelector("label[for=publishLinkAll]").textContent = t("publish.linkAll");
  dialog.querySelector("[data-copy=all]").textContent = t("publish.copyLink");
  const closeBtn = dialog.querySelector("[data-action=close]");
  closeBtn.setAttribute("aria-label", t("modal.close"));
  dialog.querySelectorAll(".publish-tileset-note[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });

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
    label.className = "publish-venue-name";
    label.textContent = venue.name;
    const row = document.createElement("div");
    row.className = "publish-link-row";
    const input = document.createElement("input");
    input.type = "text";
    input.readOnly = true;
    input.value = venue.url;
    input.setAttribute("aria-label", `${t("publish.linkVenue")}: ${venue.name}`);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "primary-btn";
    btn.textContent = t("publish.copyLink");
    btn.addEventListener("click", () => copyWithFeedback(btn, venue.url));
    row.append(input, btn);
    li.append(label, row);
    list.appendChild(li);
  }

  const copyAll = dialog.querySelector("[data-copy=all]");
  copyAll.onclick = () => copyWithFeedback(copyAll, allInput.value);
  dialog.showModal();
  // Start on the most useful action rather than the close button.
  (list.querySelector("button") ?? copyAll).focus();
}