import { t } from "./i18n.js";
import { slugifyVenueId } from "./session.js";

export function renderVenuesPanel({
  container,
  venues,
  buildings,
  activeVenueFilter,
  onAddVenue,
  onUpdateVenue,
  onDeleteVenue,
  onToggleBuildingAssignment,
  onSetVenueFilter,
  onExportViewer,
}) {
  if (!container) return;
  container.innerHTML = "";

  const toolbar = document.createElement("div");
  toolbar.className = "venue-toolbar";
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "secondary-btn";
  addBtn.textContent = t("venue.add");
  addBtn.addEventListener("click", onAddVenue);
  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "secondary-btn";
  exportBtn.textContent = t("venue.exportPackage");
  exportBtn.disabled = venues.length === 0;
  exportBtn.addEventListener("click", onExportViewer);
  toolbar.append(addBtn, exportBtn);
  container.appendChild(toolbar);

  if (venues.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-msg";
    empty.textContent = t("venue.empty");
    container.appendChild(empty);
    return;
  }

  const list = document.createElement("ul");
  list.className = "venue-list";
  for (const venue of venues) {
    list.appendChild(buildVenueRow(venue, {
      buildings,
      activeVenueFilter,
      onUpdateVenue,
      onDeleteVenue,
      onToggleBuildingAssignment,
      onSetVenueFilter,
    }));
  }
  container.appendChild(list);
}

function buildVenueRow(venue, ctx) {
  const li = document.createElement("li");
  li.className = "venue-row" + (venue._expanded ? " expanded" : "");

  const header = document.createElement("div");
  header.className = "venue-row-header";
  const count = ctx.buildings.filter((b) => b.venueId === venue.id).length;
  const chevron = document.createElement("button");
  chevron.type = "button";
  chevron.className = "venue-chevron";
  chevron.textContent = venue._expanded ? "▾" : "▸";
  chevron.addEventListener("click", () => {
    venue._expanded = !venue._expanded;
    ctx.onUpdateVenue(venue);
  });
  const title = document.createElement("span");
  title.className = "venue-row-title";
  title.textContent = `${venue.name} (${count})`;
  const filterBtn = document.createElement("button");
  filterBtn.type = "button";
  filterBtn.className = "venue-filter-btn" + (ctx.activeVenueFilter === venue.id ? " active" : "");
  filterBtn.title = t("venue.filterScene");
  filterBtn.textContent = "◎";
  filterBtn.addEventListener("click", () => ctx.onSetVenueFilter(ctx.activeVenueFilter === venue.id ? null : venue.id));
  header.append(chevron, title, filterBtn);
  li.appendChild(header);

  if (!venue._expanded) return li;

  const body = document.createElement("div");
  body.className = "venue-row-body";

  const nameLabel = document.createElement("label");
  nameLabel.textContent = t("venue.name");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = venue.name;
  nameInput.addEventListener("change", () => {
    venue.name = nameInput.value.trim() || venue.name;
    ctx.onUpdateVenue(venue);
  });
  nameLabel.appendChild(nameInput);

  const idLabel = document.createElement("label");
  idLabel.textContent = t("venue.id");
  const idInput = document.createElement("input");
  idInput.type = "text";
  idInput.value = venue.id;
  idInput.pattern = "[a-z0-9-]+";
  idInput.addEventListener("change", () => {
    const next = slugifyVenueId(idInput.value);
    if (next) {
      venue.id = next;
      idInput.value = next;
      ctx.onUpdateVenue(venue);
    }
  });
  idLabel.appendChild(idInput);

  const descLabel = document.createElement("label");
  descLabel.textContent = t("venue.description");
  const descInput = document.createElement("textarea");
  descInput.rows = 2;
  descInput.value = venue.description ?? "";
  descInput.addEventListener("change", () => {
    venue.description = descInput.value;
    ctx.onUpdateVenue(venue);
  });
  descLabel.appendChild(descInput);

  const assignedLabel = document.createElement("p");
  assignedLabel.className = "venue-assigned-label";
  assignedLabel.textContent = t("venue.assignedBuildings");

  const checklist = document.createElement("ul");
  checklist.className = "venue-building-checklist";
  for (const b of ctx.buildings) {
    const item = document.createElement("li");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = b.venueId === venue.id;
    cb.addEventListener("change", () => ctx.onToggleBuildingAssignment(b, venue.id, cb.checked));
    const label = document.createElement("label");
    label.append(cb, document.createTextNode(b.name));
    item.appendChild(label);
    checklist.appendChild(item);
  }

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "secondary-btn";
  deleteBtn.textContent = t("venue.delete");
  deleteBtn.addEventListener("click", () => ctx.onDeleteVenue(venue));

  body.append(nameLabel, idLabel, descLabel, assignedLabel, checklist, deleteBtn);
  li.appendChild(body);
  return li;
}

export function promptVenueName(defaultName = "") {
  const name = prompt(t("venue.namePrompt"), defaultName);
  if (!name?.trim()) return null;
  const baseId = slugifyVenueId(name);
  return { name: name.trim(), id: baseId, description: "", _expanded: true };
}