# Feature: Venue Management

Create, edit, and publish named venue groups that bundle multiple buildings together.

## Sub-features

1. **Create venue**: Add a new venue with a name, assign buildings
2. **Edit venue**: Rename a venue, add/remove buildings
3. **Delete venue**: Remove a venue (buildings remain in the scene)
4. **Venue filtering**: Show only buildings that belong to the selected venue
5. **Publish venue**: Upload the venue and its tilesets to the Express server

## How to get to it (user POV)

### View Venues

1. Open the authoring interface (`http://localhost:5173/`)
2. Load one or more tilesets (see [Tileset Loading](./tileset-loading.md))
3. In the left panel's **Scene** tab, scroll to the **Venues** section (at the top)
4. The section shows:
   - A list of venues (empty if none exist)
   - A **"+ New venue"** button to create a venue

### Create a Venue

1. Click **"+ New venue"** in the Venues section (`#venuesSectionBody`)
2. A popover appears with inputs:
   - **Venue name**: A label for the venue (e.g., "Tokyo Station")
   - **Buildings**: A list of checkboxes for all buildings in the scene
3. Enter a name and check one or more buildings
4. Click **"OK"**
5. The venue appears in the Venues section with:
   - Venue name (e.g., "Tokyo Station")
   - Building count (e.g., "2 buildings")
   - A filter button to show only that venue

### Edit a Venue

1. Right-click a venue in the Venues section
2. Select **"Edit"** from the context menu
3. A popover appears with the current venue name and building assignments
4. Change the name or toggle building assignments
5. Click **"OK"**
6. The venue updates in the Venues section

### Delete a Venue

1. Right-click a venue in the Venues section
2. Select **"Delete"** from the context menu
3. The venue is removed from the list
4. Buildings remain in the scene (they are not deleted)

### Filter by Venue

1. Click the filter button next to a venue name
2. The Cesium viewport hides all buildings **not** in the venue
3. The scene tree dims non-venue buildings
4. Click the filter button again to show all buildings

### Publish a Venue

1. In the header, click **"Publish to server"** (`#publishBtn`)
2. A dialog appears with:
   - Venue selector (if venues exist)
   - Publish options (mirror vs. upload)
   - Token input (if `PUBLISH_TOKEN` is required)
3. Select a venue from the dropdown
4. Click **"Publish"**
5. The app uploads:
   - Tileset files (if not already on the server)
   - Session JSON (with venue metadata, floor levels, layer colors)
6. A success dialog appears with a shareable link (e.g., `/viewer.html?venue=<id>`)

## Driving it with Playwright/CLI

### CLI: No Direct Command (Use Playwright)

The CLI does not have a built-in command for venue management. Use Playwright to drive the UI directly.

### Playwright Recipe: Create a Venue

```javascript
// 1. Load at least one tileset
await page.goto('http://localhost:5173/');
await page.locator('#addDataBtn').click();
await page.locator('#leftAddDataMenu [data-action="add-url"]').click();
await page.locator('#urlInput').fill('/tiles/sample-indoor/tileset.json');
await page.locator('#loadUrlBtn').click();
await page.waitForSelector('.bldg-row .bldg-name', { timeout: 45000 });

// 2. Click "+ New venue"
await page.locator('#venuesSectionBody button').filter({ hasText: 'New venue' }).click();

// 3. Fill the venue popover
const venuePopover = page.locator('.left-popover').filter({ hasText: 'OK' }).last();
await venuePopover.locator('input[type="text"]').first().fill('Tokyo Station');

// 4. Check at least one building
await venuePopover.locator('input[type="checkbox"]').first().check();

// 5. Click OK
await venuePopover.getByRole('button', { name: 'OK' }).click();

// 6. Verify the venue appears
await expect(page.locator('#venuesSectionBody').filter({ hasText: 'Tokyo Station' })).toBeVisible();
```

### Playwright Recipe: Edit a Venue

```javascript
// 1. Right-click the venue
const venue = page.locator('#venuesSectionBody .venue-row').filter({ hasText: 'Tokyo Station' }).first();
await venue.click({ button: 'right' });

// 2. Select "Edit"
await page.locator('#floatingMenu li').filter({ hasText: 'Edit' }).click();

// 3. Change the name
const editPopover = page.locator('.left-popover').filter({ hasText: 'OK' }).last();
await editPopover.locator('input[type="text"]').first().fill('Tokyo Station (Updated)');

// 4. Click OK
await editPopover.getByRole('button', { name: 'OK' }).click();

// 5. Verify the name changed
await expect(page.locator('#venuesSectionBody').filter({ hasText: 'Tokyo Station (Updated)' })).toBeVisible();
```

### Playwright Recipe: Delete a Venue

```javascript
// 1. Right-click the venue
const venue = page.locator('#venuesSectionBody .venue-row').filter({ hasText: 'Tokyo Station' }).first();
await venue.click({ button: 'right' });

// 2. Select "Delete"
await page.locator('#floatingMenu li').filter({ hasText: 'Delete' }).click();

// 3. Verify the venue is gone
await expect(page.locator('#venuesSectionBody').filter({ hasText: 'Tokyo Station' })).toBeHidden();
```

### Playwright Recipe: Publish a Venue

```javascript
// 1. Create a venue first (see above)

// 2. Click "Publish to server"
await page.locator('#publishBtn').click();

// 3. Wait for the publish dialog
await page.waitForSelector('#publishLinksDialog', { state: 'visible', timeout: 10000 });

// 4. Select the venue from the dropdown
const venueSelect = page.locator('#publishLinksDialog select').first();
await venueSelect.selectOption({ label: 'Tokyo Station' });

// 5. Click "Publish" (or "Mirror" depending on the button text)
await page.locator('#publishLinksDialog button').filter({ hasText: 'Publish' }).click();

// 6. Wait for success (the dialog updates with a shareable link)
await page.waitForSelector('#publishLinksDialog', { hasText: 'viewer.html?venue=' }, { timeout: 60000 });

// 7. Extract the shareable link
const link = await page.locator('#publishLinksDialog').textContent();
console.log('Published venue link:', link);
```

### Key Selectors

- `#venuesSection` — Venues section container
- `#venuesSectionBody` — Venues list (contains venue rows)
- `.venue-row` — Individual venue row
- `.venue-name` — Venue name text
- `.venue-building-count` — Building count text (e.g., "2 buildings")
- `.venue-filter-btn` — Filter button to show only that venue
- `#publishBtn` — "Publish to server" button in the header
- `#publishLinksDialog` — Publish dialog modal
- `#floatingMenu` — Context menu for right-click actions

### Observable End State

**After creating a venue**:
- A new `.venue-row` appears in `#venuesSectionBody`
- The venue name and building count are visible
- The session JSON (in memory) includes the venue metadata

**After editing a venue**:
- The `.venue-name` updates with the new name
- Building assignments reflect the changes

**After deleting a venue**:
- The `.venue-row` is removed from `#venuesSectionBody`
- Buildings remain in the scene (they are not affected)

**After filtering by venue**:
- Buildings **not** in the venue are hidden in the Cesium viewport
- The scene tree dims non-venue buildings
- The filter button shows an active state (e.g., highlighted)

**After publishing a venue**:
- The Express server stores:
  - Session JSON at `/sessions/<id>.json`
  - Tileset files at `/tilesets/<hash>/` (if uploaded)
- The publish dialog shows a shareable link (e.g., `/viewer.html?venue=<id>`)
- Opening the link in `viewer.html` loads only the venue's buildings

## Gotchas

1. **Empty venue list**: The Venues section is always visible, even if no venues exist. It shows an empty state message like "No venues. Click + New venue."

2. **Building assignment**: A building can belong to **multiple venues**. If you filter by Venue A, then filter by Venue B, the viewport switches to show only Venue B's buildings.

3. **Publish requires a running Express server**: The publish feature uploads to `http://localhost:3001/api/publish` (or the port specified in `server/dev.js`). If the Express server is not running, the publish will fail with a network error.

4. **Publish token**: If the `PUBLISH_TOKEN` environment variable is set on the server, the client must provide a matching token in the publish dialog. Otherwise, the server returns a 401 Unauthorized error.

5. **Mirror vs. Upload**: The publish dialog offers two modes:
   - **Mirror**: Assumes tilesets are already on the server at the same URL. Only uploads the session JSON.
   - **Upload**: Uploads both tilesets and session JSON. This is slower but works for local tilesets.

6. **Shareable link format**: Published venues generate a link like `/viewer.html?venue=<id>`. The `<id>` is derived from the venue name (slugified). If you rename a venue, the old link will break.

7. **Context menu positioning**: The `#floatingMenu` is positioned at the cursor. If the cursor is near the edge, the menu may overflow off-screen. Wait for it to be visible before clicking menu items.

8. **No undo for delete**: Deleting a venue is permanent (in the current session). To undo, reload the page and restore from a session backup (see the "Backups" button in the header).

9. **Venue metadata in session JSON**: Venues are stored in the session JSON under a `venues` array. Each venue has:
   - `id`: Slugified venue name
   - `name`: Display name
   - `buildingIds`: Array of building IDs assigned to the venue
   If you export/restore a session, venues are preserved.
