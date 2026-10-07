import { t, getLanguage } from "./i18n.js";
import { listBackups, saveBackup, deleteBackup } from "./sessionBackupStore.js";
import { diffSessions } from "./sessionDiff.js";
import { openSessionDiffDialog, describeChange } from "./sessionDiffDialog.js";
import { groupBackupsByDay } from "./backupGroups.js";

const MAX_INLINE_CHANGES = 4;
const CLOSE_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const TRASH_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

let dialogEl = null;

// A drawer on the right edge: the list of backups grouped by day.
function ensureDialog() {
  if (dialogEl) return dialogEl;
  dialogEl = document.createElement("dialog");
  dialogEl.id = "sessionBackupsDialog";
  dialogEl.className = "backups-drawer";
  dialogEl.setAttribute("aria-labelledby", "sessionBackupsTitle");
  dialogEl.innerHTML = `
    <div class="backups-head">
      <h2 id="sessionBackupsTitle" class="app-dialog-title"></h2>
      <button type="button" class="app-dialog-close" data-action="close">${CLOSE_ICON}</button>
    </div>
    <div class="backups-toolbar">
      <button type="button" class="primary-btn" data-action="save-now"></button>
    </div>
    <div class="backups-body">
      <div id="sessionBackupsList" class="backup-groups"></div>
      <p id="sessionBackupsEmpty" class="empty-msg" hidden></p>
    </div>
    <p class="backups-foot"></p>
  `;
  document.body.appendChild(dialogEl);
  dialogEl.addEventListener("click", (e) => {
    if (e.target === dialogEl) dialogEl.close();
  });
  dialogEl.querySelector("[data-action=close]").addEventListener("click", () => dialogEl.close());
  return dialogEl;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString(getLanguage(), { hour: "2-digit", minute: "2-digit" });
}

function formatDay(group) {
  if (group.key === "today") return t("backup.today");
  if (group.key === "yesterday") return t("backup.yesterday");
  return new Date(group.dayStart).toLocaleDateString(getLanguage(), {
    weekday: "short", month: "short", day: "numeric",
  });
}

export async function openSessionBackupsDialog({ getCurrentSession, onRestore }) {
  const dialog = ensureDialog();
  const listEl = dialog.querySelector("#sessionBackupsList");
  const emptyEl = dialog.querySelector("#sessionBackupsEmpty");
  let expandedId = null;
  let backups = [];

  dialog.querySelector("#sessionBackupsTitle").textContent = t("backup.title");
  const closeBtn = dialog.querySelector("[data-action=close]");
  closeBtn.setAttribute("aria-label", t("modal.close"));
  closeBtn.title = t("modal.close");
  dialog.querySelector("[data-action=save-now]").textContent = t("backup.saveNow");
  dialog.querySelector(".backups-foot").textContent = t("backup.restoreHint");
  emptyEl.textContent = t("backup.empty");

  const buildChanges = (entry) => {
    const wrap = document.createElement("div");
    wrap.className = "backup-changes";
    const heading = document.createElement("p");
    heading.className = "backup-changes-title";
    heading.textContent = t("backup.vsNow");
    wrap.appendChild(heading);

    const changes = diffSessions(entry.session, getCurrentSession());
    if (changes.length === 0) {
      const none = document.createElement("p");
      none.className = "backup-changes-none";
      none.textContent = t("diff.noChanges");
      wrap.appendChild(none);
      return wrap;
    }
    const ul = document.createElement("ul");
    for (const change of changes.slice(0, MAX_INLINE_CHANGES)) {
      const li = document.createElement("li");
      li.className = `diff-item diff-${change.type}`;
      li.textContent = describeChange(change);
      ul.appendChild(li);
    }
    wrap.appendChild(ul);
    if (changes.length > MAX_INLINE_CHANGES) {
      const more = document.createElement("p");
      more.className = "backup-changes-more";
      more.textContent = t("backup.more", { count: changes.length - MAX_INLINE_CHANGES });
      wrap.appendChild(more);
    }
    return wrap;
  };

  const buildRow = (entry) => {
    const expanded = entry.id === expandedId;
    const li = document.createElement("li");
    li.className = "backup-row" + (expanded ? " expanded" : "");

    const summary = document.createElement("button");
    summary.type = "button";
    summary.className = "backup-summary";
    summary.setAttribute("aria-expanded", String(expanded));
    const label = document.createElement("span");
    label.className = "backup-label";
    label.textContent = entry.label || t("backup.unnamed");
    const meta = document.createElement("span");
    meta.className = "backup-meta";
    const source = document.createElement("span");
    source.className = `backup-source source-${entry.source === "auto" ? "auto" : "manual"}`;
    source.textContent = t(entry.source === "auto" ? "backup.source.auto" : "backup.source.manual");
    const time = document.createElement("time");
    time.className = "backup-time";
    time.dateTime = new Date(entry.createdAt).toISOString();
    time.textContent = formatTime(entry.createdAt);
    meta.append(source, time);
    summary.append(label, meta);
    summary.addEventListener("click", () => {
      expandedId = expanded ? null : entry.id;
      renderList();
    });
    li.appendChild(summary);

    if (expanded) {
      li.appendChild(buildChanges(entry));
      const actions = document.createElement("div");
      actions.className = "backup-actions";

      const restoreBtn = document.createElement("button");
      restoreBtn.type = "button";
      restoreBtn.className = "primary-btn";
      restoreBtn.textContent = t("backup.restore");
      restoreBtn.addEventListener("click", async () => {
        if (!confirm(t("backup.confirmRestore"))) return;
        dialog.close();
        await onRestore(entry);
      });

      const compareBtn = document.createElement("button");
      compareBtn.type = "button";
      compareBtn.className = "secondary-btn";
      compareBtn.textContent = t("backup.compare");
      compareBtn.addEventListener("click", () => {
        openSessionDiffDialog({ backups, getCurrentSession, initialLeftId: entry.id });
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "icon-btn backup-delete";
      deleteBtn.innerHTML = TRASH_ICON;
      deleteBtn.title = t("backup.delete");
      deleteBtn.setAttribute("aria-label", t("backup.delete"));
      deleteBtn.addEventListener("click", async () => {
        await deleteBackup(entry.id);
        expandedId = null;
        await render();
      });

      actions.append(restoreBtn, compareBtn, deleteBtn);
      li.appendChild(actions);
    }
    return li;
  };

  const renderList = () => {
    listEl.textContent = "";
    emptyEl.hidden = backups.length > 0;
    for (const group of groupBackupsByDay(backups)) {
      const section = document.createElement("section");
      section.className = "backup-group";
      const heading = document.createElement("h3");
      heading.className = "backup-group-title";
      heading.textContent = formatDay(group);
      const ul = document.createElement("ul");
      ul.className = "backup-list";
      for (const entry of group.items) ul.appendChild(buildRow(entry));
      section.append(heading, ul);
      listEl.appendChild(section);
    }
  };

  const render = async () => {
    backups = await listBackups();
    if (expandedId == null && backups.length > 0) expandedId = backups[0].id;
    renderList();
  };

  dialog.querySelector("[data-action=save-now]").onclick = async () => {
    const label = prompt(t("backup.labelPrompt"), "") ?? "";
    const saved = await saveBackup(getCurrentSession(), { label: label.trim() || null, source: "manual" });
    expandedId = saved?.id ?? null;
    await render();
  };

  await render();
  if (!dialog.open) dialog.showModal();
}

export async function createAutoBackup(getCurrentSession, label) {
  return saveBackup(getCurrentSession(), { label, source: "auto" });
}
