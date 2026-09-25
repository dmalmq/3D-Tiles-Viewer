# Feature: Floor Management

Assign floor levels to 3D Tiles features, add/edit/delete levels, and enable clipping planes for interior views.

## Sub-features

1. **Floor detection**: Auto-detect floors from feature properties (`_floor`, `level`, `storey`, etc.)
2. **Add level**: Create a new floor level with a name and elevation
3. **Edit level**: Rename a floor or change its elevation
4. **Delete level**: Remove a floor from the building
5. **Clipping planes**: Enable floor cutaways to see building interiors
6. **Cross-building floor selector**: Navigate across all buildings by floor (e.g., "Show all 1F layers")

## How to get to it (user POV)

### View Floors

1. Open the authoring interface (`http://localhost:5173/`)
2. Load a tileset (see [Tileset Loading](./tileset-loading.md))
3. In the left panel's **Scene** tab, expand a building row (`.bldg-row`)
4. The building expands to show floor levels (`.bldg-level-row`)
5. Each level has:
   - A name (e.g., "1F", "Ground Floor")
   - An elevation (e.g., "0.0 m")
   - An eye icon to toggle visibility
   - A scissor icon to enable clipping

### Add a Level

1. Right-click a building row (`.bldg-row`)
2. Select **"Add level"** from the context menu (`#floatingMenu`)
3. A popover appears with two inputs:
   - **Name**: Floor label (e.g., "1F")
   - **Elevation**: Height above ground in meters (e.g., "0")
4. Click **"OK"**
5. The new level appears in the building's floor list

### Edit a Level

1. Right-click a floor level row (`.bldg-level-row`)
2. Select **"Edit name"** from the context menu
3. A popover appears with the current name
4. Change the name (e.g., "1F" → "1F Edited")
5. Click **"OK"**
6. The level's name updates in the scene tree

### Enable Clipping

1. Click the scissor icon next to a floor level
2. A clipping plane enables at that floor's elevation
3. The Cesium viewport shows a cutaway view:
   - Everything below the clipping plane is visible
   - Everything above is hidden
4. Click the scissor icon again to disable clipping

### Cross-Building Floor Selector

1. Load multiple buildings with floor metadata
2. Above the scene tree, a row of **level pills** appears (horizontal scrollable list)
3. Each pill represents a unique floor name across all buildings (e.g., "1F", "2F", "3F")
4. Click a pill to:
   - Highlight all 1F floors across all buildings
   - Optionally enable clipping on all 1F floors (depending on UI state)

## Driving it with Playwright/CLI

### CLI: No Direct Command (Use Playwright)

The CLI does not have a built-in command for floor management. Use Playwright to drive the UI directly.

### Playwright Recipe: Add a Level

```javascript
// 1. Load a tileset
await page.goto('http://localhost:5173/');
await page.locator('#addDataBtn').click();
await page.locator('#leftAddDataMenu [data-action="add-url"]').click();
await page.locator('#urlInput').fill('/tiles/sample-indoor/tileset.json');
await page.locator('#loadUrlBtn').click();
await page.waitForSelector('.bldg-row .bldg-name', { timeout: 45000 });

// 2. Right-click the building row
const buildingRow = page.locator('.bldg-row').filter({ hasText: 'sample-indoor' }).first();
await buildingRow.click({ button: 'right' });

// 3. Select "Add level" from the context menu
await page.locator('#floatingMenu li').filter({ hasText: 'Add level' }).click();

// 4. Fill the popover
const popover = page.locator('.left-popover').filter({ hasText: 'OK' }).last();
await popover.locator('input').nth(0).fill('1F');
await popover.locator('input').nth(1).fill('0');

// 5. Click OK
await popover.getByRole('button', { name: 'OK' }).click();

// 6. Verify the level appears
await expect(page.locator('.bldg-level-row').filter({ hasText: '1F' })).toBeVisible();
```

### Playwright Recipe: Edit a Level

```javascript
// 1. Right-click the level row
const levelRow = page.locator('.bldg-level-row').filter({ hasText: '1F' }).first();
await levelRow.click({ button: 'right' });

// 2. Select "Edit name"
await page.locator('#floatingMenu li').filter({ hasText: 'Edit name' }).click();

// 3. Fill the popover with a new name
const editPopover = page.locator('.left-popover').filter({ hasText: 'OK' }).last();
await editPopover.locator('input').first().fill('1F Edited');

// 4. Click OK
await editPopover.getByRole('button', { name: 'OK' }).click();

// 5. Verify the name changed
await expect(page.locator('.bldg-level-row .level-name-text').filter({ hasText: '1F Edited' })).toBeVisible();
```

### Playwright Recipe: Enable Clipping

```javascript
// 1. Find the scissor icon for a floor level
const levelRow = page.locator('.bldg-level-row').filter({ hasText: '1F' }).first();
const clippingBtn = levelRow.locator('.level-clipping-btn');

// 2. Click to enable clipping
await clippingBtn.click();

// 3. Wait for the clipping plane to activate (visual change in Cesium)
await page.waitForTimeout(500);

// 4. Verify the button is in an active state (aria-pressed or class change)
// (This depends on the actual implementation; check the CSS class or aria attribute)
```

### Key Selectors

- `.bldg-row` — Building row in the scene tree
- `.bldg-name` — Building name text
- `.bldg-level-row` — Floor level row (child of `.bldg-row`)
- `.level-name-text` — Floor name text (e.g., "1F")
- `.level-elevation` — Floor elevation text (e.g., "0.0 m")
- `.level-visibility-btn` — Eye icon to toggle floor visibility
- `.level-clipping-btn` — Scissor icon to toggle clipping
- `#floatingMenu` — Context menu for right-click actions
- `.left-popover` — Popover for add/edit level inputs
- `#levelPillsRow` — Container for cross-building floor pills

### Observable End State

**After adding a level**:
- A new `.bldg-level-row` appears with the specified name and elevation
- The level is visible in the scene tree
- The Cesium viewport may highlight features at that elevation (if any)

**After editing a level**:
- The `.level-name-text` updates with the new name
- The level's data in the session JSON (in memory) reflects the change

**After enabling clipping**:
- The Cesium viewport shows a cutaway view at the clipping plane's elevation
- The scissor icon changes appearance (e.g., highlighted or pressed state)
- Only features below the clipping plane are visible

## Gotchas

1. **Auto-detection depends on properties**: Floor detection looks for properties like `_floor`, `level`, `storey`, `height`, etc. If a tileset doesn't have these properties, no floors are auto-detected, and you'll need to add them manually.

2. **Elevation units**: Elevation is in **meters** above the tileset's origin (not absolute elevation). If the tileset is positioned incorrectly, the clipping plane may not align with building floors.

3. **Clipping plane z-fighting**: When the clipping plane is at the exact elevation of a feature, you may see z-fighting (flickering polygons). Adjust the elevation slightly (+0.1 or -0.1 meters) to avoid this.

4. **Context menu positioning**: The `#floatingMenu` is positioned absolutely at the cursor's location. It may overflow off-screen if the cursor is near the edge. Wait for it to be visible before clicking menu items.

5. **Popover input focus**: When the add/edit level popover appears, the first input is auto-focused. If you're driving with Playwright, ensure the popover is visible (`{ state: 'visible' }`) before filling inputs.

6. **Cross-building pills visibility**: Level pills (`#levelPillsRow`) only appear if:
   - Multiple buildings are loaded, OR
   - At least one building has floors
   If no floors exist, the pills row is hidden.

7. **Clipping persistence**: Clipping state is not persisted to the session JSON by default (it's a viewport-only setting). If you reload the page, clipping is disabled. To persist clipping, you'd need to add it to the session export logic.

8. **Delete confirmation**: Deleting a level does not show a confirmation dialog. The level is removed immediately. If you delete by mistake, use "Undo" (if available) or reload the page and restore from a session backup.
