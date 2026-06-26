import { t } from "./i18n.js";
import { listBackups, saveBackup, deleteBackup } from "./sessionBackupStore.js";
import { openSessionDiffDialog } from "./sessionDiffDialog.js";

let dialogEl = null;

function ensureDialog() {
  if (dialogEl) return dialogEl;
  dialogEl = document.createElement("dialog");
  dialogEl.id = "sessionBackupsDialog";
  dialogEl.className = "modal-dialog";
  dialogEl.innerHTML = `
    <div class="modal-dialog-header">
      <h2 data-i18n="backup.title">Session backups</h2>
      <button type="button" class="modal-close-btn" data-action="close" aria-label="Close">×</button>
    </div>
    <div class="modal-dialog-body">
      <div class="backup-toolbar">
        <button type="button" class="secondary-btn" data-action="save-now" data-i18n="backup.saveNow">Save backup now</button>
      </div>
      <ul id="sessionBackupsList" class="backup-list"></ul>
      <p id="sessionBackupsEmpty" class="empty-msg" hidden data-i18n="backup.empty">No backups yet.</p>
    </div>
  `;
  document.body.appendChild(dialogEl);
  dialogEl.addEventListener("click", (e) => {
    if (e.target === dialogEl) dialogEl.close();
  });
  dialogEl.querySelector("[data-action=close]").addEventListener("click", () => dialogEl.close());
  return dialogEl;
}

function formatTimestamp(ts) {
  return new Date(ts).toLocaleString();
}

export async function openSessionBackupsDialog({ getCurrentSession, onRestore }) {
  const dialog = ensureDialog();
  const listEl = dialog.querySelector("#sessionBackupsList");
  const emptyEl = dialog.querySelector("#sessionBackupsEmpty");

  const render = async () => {
    const backups = await listBackups();
    listEl.innerHTML = "";
    emptyEl.hidden = backups.length > 0;
    for (const entry of backups) {
      const li = document.createElement("li");
      li.className = "backup-row";
      const meta = document.createElement("div");
      meta.className = "backup-meta";
      const label = entry.label || t("backup.unnamed");
      meta.innerHTML = `<strong>${label}</strong><span>${formatTimestamp(entry.createdAt)}</span><span class="backup-source">${entry.source}</span>`;
      const actions = document.createElement("div");
      actions.className = "backup-actions";

      const restoreBtn = document.createElement("button");
      restoreBtn.type = "button";
      restoreBtn.className = "secondary-btn";
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
        openSessionDiffDialog({
          backups,
          getCurrentSession,
          initialLeftId: entry.id,
        });
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "secondary-btn";
      deleteBtn.textContent = t("generic.removeX");
      deleteBtn.addEventListener("click", async () => {
        await deleteBackup(entry.id);
        await render();
      });

      actions.append(restoreBtn, compareBtn, deleteBtn);
      li.append(meta, actions);
      listEl.appendChild(li);
    }
  };

  dialog.querySelector("[data-action=save-now]").onclick = async () => {
    const label = prompt(t("backup.labelPrompt"), "") ?? "";
    await saveBackup(getCurrentSession(), { label: label.trim() || null, source: "manual" });
    await render();
  };

  await render();
  dialog.showModal();
}

export async function createAutoBackup(getCurrentSession, label) {
  return saveBackup(getCurrentSession(), { label, source: "auto" });
}