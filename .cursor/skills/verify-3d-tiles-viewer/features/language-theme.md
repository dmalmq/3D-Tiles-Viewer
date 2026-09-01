# Feature: Language and Theme Switching

Toggle the UI language between English and Japanese, and switch between light and dark themes.

## Sub-features

1. **Language Toggle**: Switch between English (EN) and Japanese (JA)
2. **Theme Toggle**: Switch between dark and light mode
3. **Persistence**: Preferences are saved to `localStorage` and persist across page reloads

## How to get to it (user POV)

### Language Toggle

1. Open the authoring interface or viewer (`http://localhost:5173/` or `http://localhost:5173/viewer.html`)
2. Look at the top-right corner of the header
3. Click the **language toggle button** (labeled "あ" for Japanese or "A" for English)
4. The entire UI re-renders with translated strings
   - English: "3D Tiles Viewer", "Scene", "Layers", "Add Data", etc.
   - Japanese: "3D タイルビューア", "シーン", "レイヤー", "データを追加", etc.

### Theme Toggle

1. Open the authoring interface or viewer
2. Look at the top-right corner of the header (next to the language toggle)
3. Click the **theme toggle button** (moon icon in dark mode, sun icon in light mode)
4. The entire UI switches color schemes:
   - **Dark mode** (default): Dark gray backgrounds, light text, blue accents
   - **Light mode**: Light gray/white backgrounds, dark text, blue accents

## Driving it with Playwright/CLI

### CLI Commands

**Switch language**:

```bash
./.cursor/skills/verify-3d-tiles-viewer/control-3d-tiles-viewer.mjs switch-language
```

**Switch theme**:

```bash
./.cursor/skills/verify-3d-tiles-viewer/control-3d-tiles-viewer.mjs switch-theme
```

Both commands return before/after values in JSON when `--json` is passed.

### Playwright Recipe: Language

```javascript
// 1. Open the app
await page.goto('http://localhost:5173/');
await page.waitForSelector('#languageToggle', { timeout: 10000 });

// 2. Read the current language
const beforeLang = await page.evaluate(() => localStorage.getItem('language') || 'en');

// 3. Click the language toggle
await page.locator('#languageToggle').click();

// 4. Wait for the UI to re-render (optional, but good practice)
await page.waitForTimeout(500);

// 5. Read the new language
const afterLang = await page.evaluate(() => localStorage.getItem('language') || 'en');

// 6. Verify the switch
console.log(`Language switched: ${beforeLang} → ${afterLang}`);
// Expected: "en" → "ja" or "ja" → "en"
```

### Playwright Recipe: Theme

```javascript
// 1. Open the app
await page.goto('http://localhost:5173/');
await page.waitForSelector('#themeToggle', { timeout: 10000 });

// 2. Read the current theme
const beforeTheme = await page.evaluate(() => localStorage.getItem('theme') || 'dark');

// 3. Click the theme toggle
await page.locator('#themeToggle').click();

// 4. Wait for the theme to apply (optional)
await page.waitForTimeout(500);

// 5. Read the new theme
const afterTheme = await page.evaluate(() => localStorage.getItem('theme') || 'dark');

// 6. Verify the switch
console.log(`Theme switched: ${beforeTheme} → ${afterTheme}`);
// Expected: "dark" → "light" or "light" → "dark"
```

### Key Selectors

- `#languageToggle` — Language toggle button (top-right header)
- `#languageToggleLabel` — The label inside the button ("あ" or "A")
- `#themeToggle` — Theme toggle button (top-right header)
- `.theme-icon-dark` — Moon icon (visible in dark mode)
- `.theme-icon-light` — Sun icon (visible in light mode)
- `[data-i18n="header.title"]` — Header title (translates to "3D Tiles Viewer" or "3D タイルビューア")

### Observable End State

**Language**:
- `localStorage.language` changes to `"en"` or `"ja"`
- All elements with `data-i18n` attributes re-render with translated text
- Example: `[data-i18n="header.title"]` shows "3D Tiles Viewer" (EN) or "3D タイルビューア" (JA)

**Theme**:
- `localStorage.theme` changes to `"dark"` or `"light"`
- The `<body>` element gets a `data-theme="light"` or `data-theme="dark"` attribute
- CSS custom properties (e.g., `--bg-primary`, `--text-primary`) update to match the theme
- Visual: Background and text colors invert

## Gotchas

1. **Initial state**: If `localStorage` is empty (first visit), the app defaults to:
   - Language: `"en"` (English)
   - Theme: `"dark"` (dark mode)

2. **Page reload**: Preferences persist across page reloads because they're stored in `localStorage`. Clear `localStorage` to reset to defaults:
   ```javascript
   await page.evaluate(() => localStorage.clear());
   ```

3. **Viewport-only changes**: Language and theme changes are instant and don't require waiting for Cesium to re-render. However, if you're capturing screenshots, wait ~500ms for CSS transitions to settle.

4. **Translation coverage**: Not all strings are translated. Some technical terms (e.g., "GeoPackage", "PLATEAU") remain untranslated. Check `src/i18nStrings.js` for the full translation map.

5. **Theme icons**: The theme toggle button shows different icons depending on the current theme:
   - Dark mode → moon icon (`.theme-icon-dark` visible)
   - Light mode → sun icon (`.theme-icon-light` visible)
   These icons are SVGs and won't change text content, so don't rely on `.textContent` for verification.

6. **Authoring vs. Viewer**: Both `index.html` (authoring) and `viewer.html` (viewer) support language and theme switching. They share the same `localStorage` keys, so changing the language in one page affects the other.

7. **No server round-trip**: Language and theme switches happen entirely in the browser. There's no API call to the Express server, so network stubbing is not needed.
