import { t } from "./i18n.js";
import { slugifyVenueId } from "./session.js";

const CHEVRON_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const FILTER_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.5"/></svg>';
const PLUS_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

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
}) {
  if (!container) return;
  container.innerHTML = "";

  if (venues.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-msg venue-empty";
    empty.textContent = t("venue.empty");
    container.appendChild(empty);
  } else {
    const list = document.createElement("ul");
    list.className = "venue-list";
    for (const venue of venues) {
      list.appendChild(buildVenueRow(venue, {
        buildings,
        venues,
        activeVenueFilter,
        onUpdateVenue,
        onDeleteVenue,
        onToggleBuildingAssignment,
        onSetVenueFilter,
      }));
    }
    container.appendChild(list);

    const venueIds = new Set(venues.map((v) => v.id));
    const outside = buildings.filter((b) => !venueIds.has(b.venueId)).length;
    if (outside > 0) {
      const note = document.createElement("p");
      note.className = "venue-unassigned-note";
      note.textContent = t("venue.unassignedNote", { count: outside });
      container.appendChild(note);
    }
  }

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "venue-add-btn";
  addBtn.innerHTML = PLUS_ICON;
  addBtn.append(document.createTextNode(t("venue.add")));
  addBtn.addEventListener("click", onAddVenue);
  container.appendChild(addBtn);
}

function buildVenueRow(venue, ctx) {
  const li = document.createElement("li");
  li.className = "venue-row" + (venue._expanded ? " expanded" : "");

  const header = document.createElement("div");
  header.className = "venue-row-header";
  const count = ctx.buildings.filter((b) => b.venueId === venue.id).length;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "venue-row-toggle";
  toggle.setAttribute("aria-expanded", String(!!venue._expanded));
  toggle.addEventListener("click", () => {
    venue._expanded = !venue._expanded;
    ctx.onUpdateVenue(venue);
  });
  const chevron = document.createElement("span");
  chevron.className = "venue-chevron";
  chevron.innerHTML = CHEVRON_ICON;
  const text = document.createElement("span");
  text.className = "venue-row-text";
  const title = document.createElement("span");
  title.className = "venue-row-title";
  title.textContent = venue.name;
  const meta = document.createElement("span");
  meta.className = "venue-row-meta";
  meta.textContent = t("venue.buildingCount", { count });
  text.append(title, meta);
  toggle.append(chevron, text);

  const filterOn = ctx.activeVenueFilter === venue.id;
  const filterBtn = document.createElement("button");
  filterBtn.type = "button";
  filterBtn.className = "venue-filter-btn" + (filterOn ? " active" : "");
  filterBtn.title = t("venue.filterScene");
  filterBtn.setAttribute("aria-label", t("venue.filterScene"));
  filterBtn.setAttribute("aria-pressed", String(filterOn));
  filterBtn.innerHTML = FILTER_ICON;
  filterBtn.addEventListener("click", () => ctx.onSetVenueFilter(filterOn ? null : venue.id));
  header.append(toggle, filterBtn);
  li.appendChild(header);

  if (!venue._expanded) return li;

  const body = document.createElement("div");
  body.className = "venue-row-body";

  const fields = document.createElement("div");
  fields.className = "venue-fields";

  const nameLabel = document.createElement("label");
  const nameText = document.createElement("span");
  nameText.textContent = t("venue.name");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = venue.name;
  nameInput.addEventListener("change", () => {
    venue.name = nameInput.value.trim() || venue.name;
    ctx.onUpdateVenue(venue);
  });
  nameLabel.append(nameText, nameInput);

  const idLabel = document.createElement("label");
  const idText = document.createElement("span");
  idText.textContent = t("venue.id");
  const idInput = document.createElement("input");
  idInput.type = "text";
  idInput.className = "venue-id-input";
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
  idLabel.append(idText, idInput);
  fields.append(nameLabel, idLabel);

  const descLabel = document.createElement("label");
  const descText = document.createElement("span");
  descText.textContent = t("venue.description");
  const descInput = document.createElement("textarea");
  descInput.rows = 2;
  descInput.value = venue.description ?? "";
  descInput.addEventListener("change", () => {
    venue.description = descInput.value;
    ctx.onUpdateVenue(venue);
  });
  descLabel.append(descText, descInput);

  const assignedLabel = document.createElement("p");
  assignedLabel.className = "venue-assigned-label";
  assignedLabel.textContent = t("venue.assignedBuildings");

  const venueIds = new Set(ctx.venues.map((v) => v.id));
  const checklist = document.createElement("ul");
  checklist.className = "venue-building-checklist";
  for (const b of ctx.buildings) {
    const item = document.createElement("li");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = b.venueId === venue.id;
    cb.addEventListener("change", () => ctx.onToggleBuildingAssignment(b, venue.id, cb.checked));
    const label = document.createElement("label");
    const name = document.createElement("span");
    name.className = "venue-building-name";
    name.textContent = b.name;
    label.append(cb, name);
    if (!venueIds.has(b.venueId)) {
      const hint = document.createElement("span");
      hint.className = "venue-building-hint";
      hint.textContent = t("venue.notInVenue");
      label.appendChild(hint);
    }
    item.appendChild(label);
    checklist.appendChild(item);
  }
  if (ctx.buildings.length === 0) {
    const none = document.createElement("li");
    none.className = "empty-msg";
    none.textContent = t("viewer.noBuildings");
    checklist.appendChild(none);
  }

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "venue-delete-btn";
  deleteBtn.textContent = t("venue.delete");
  deleteBtn.addEventListener("click", () => ctx.onDeleteVenue(venue));

  body.append(fields, descLabel, assignedLabel, checklist, deleteBtn);
  li.appendChild(body);
  return li;
}

export function promptVenueName(defaultName = "") {
  const name = prompt(t("venue.namePrompt"), defaultName);
  if (!name?.trim()) return null;
  const baseId = slugifyVenueId(name);
  return { name: name.trim(), id: baseId, description: "", _expanded: true };
}