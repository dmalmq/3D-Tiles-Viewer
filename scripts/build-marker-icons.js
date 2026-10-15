// Draws public/icons/marker/*.png as the Fenrir station-map pins
// (Figma gwyLPpmzk8c4ltvaxr47uM, カテゴリー分類): a circle in the spot's
// category colour with a white Material Symbols glyph, and platform numbers
// as white tags with a coloured left bar. Colours are the Spot/* and
// Icon/MapElements/* variables of Figma IiM1QNaEzWOM4uZCvsbor5 (frame 5:914).
//
// File names stay as they were, since GDB `image` values point at them.
// Run with `node scripts/build-marker-icons.js`.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "icons", "marker");
const SYMBOLS_DIR = path.join(path.dirname(require.resolve("@material-symbols/svg-400/package.json")), "rounded");

// Drawn at twice MARKER_ICON_PX so billboards stay sharp on HiDPI screens.
const SIZE = 64;

const COLOR = {
  facility: "#75B001", // Spot/Category/Facility: toilets, baby rooms, smoking
  privateFacility: "#0C9127", // Spot/Category/PrivateFacility: lockers, rooms, ATM
  highPriority: "#FB4E73", // Spot/Category/HighPriorityFacility: information
  traffic: "#51618F", // Spot/Category/Traffic: tickets, buses, taxis
  other: "#865D4E", // Spot/Category/Other
  toiletMan: "#4363BF", // Spot/Toilet_Man
  toiletWoman: "#CA3E3B", // Spot/Toilet_Woman
  mapElement: "#657678", // Icon/MapElements/Fill/Tertiary: lifts, stairs, slopes
  brand: "#197982", // Text/Brand
  border: "#CCCCCC", // Border/Secondary
  text: "#333333", // Text/Secondary
};

const PINS = {
  baby: { color: COLOR.facility, glyph: "baby_changing_station" },
  children: { color: COLOR.facility, glyph: "escalator_warning" },
  unisex: { color: COLOR.facility, glyph: "wc" },
  multipurpose: { color: COLOR.facility, glyph: "accessible" },
  smoking: { color: COLOR.facility, glyph: "smoking_rooms" },
  female: { color: COLOR.toiletWoman, glyph: "woman" },
  male: { color: COLOR.toiletMan, glyph: "man" },
  locker: { color: COLOR.privateFacility, glyph: "luggage" },
  prayer: { color: COLOR.privateFacility, glyph: "self_improvement" },
  exchange: { color: COLOR.privateFacility, glyph: "currency_exchange" },
  info: { color: COLOR.highPriority, glyph: "info_i" },
  ticket: { color: COLOR.traffic, glyph: "confirmation_number" },
  mv: { color: COLOR.traffic, glyph: "transit_ticket" },
  bus: { color: COLOR.traffic, glyph: "directions_bus" },
  taxi: { color: COLOR.traffic, glyph: "local_taxi" },
  livecamera: { color: COLOR.other, glyph: "videocam" },
  elevator: { color: COLOR.mapElement, glyph: "elevator" },
  elevator_up: { color: COLOR.mapElement, glyph: "elevator", badge: "arrow_upward" },
  elevator_down: { color: COLOR.mapElement, glyph: "elevator", badge: "arrow_downward" },
  escalator: { color: COLOR.mapElement, glyph: "escalator" },
  stairs_up: { color: COLOR.mapElement, glyph: "stairs", badge: "arrow_upward" },
  stairs_down: { color: COLOR.mapElement, glyph: "stairs", badge: "arrow_downward" },
  slope: { color: COLOR.mapElement, glyph: "accessible_forward" },
};

const PLATFORM_COUNT = 11;

function symbolPaths(name) {
  const svg = readFileSync(path.join(SYMBOLS_DIR, `${name}-fill.svg`), "utf8");
  return [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
}

// Places a 960-unit Material Symbol (viewBox 0 -960 960 960) in a box.
function glyph(name, { x, y, size, fill }) {
  const scale = size / 960;
  return `<g transform="translate(${x} ${y + size}) scale(${scale})" fill="${fill}">${symbolPaths(name)
    .map((d) => `<path d="${d}"/>`)
    .join("")}</g>`;
}

function pinSvg({ color, glyph: name, badge }) {
  const c = SIZE / 2;
  const glyphSize = 36;
  let svg = `<circle cx="${c}" cy="${c}" r="${c - 3}" fill="${color}" stroke="#fff" stroke-width="4"/>`;
  svg += glyph(name, { x: c - glyphSize / 2, y: c - glyphSize / 2, size: glyphSize, fill: "#fff" });
  if (badge) {
    const r = 11;
    const bx = SIZE - r - 1;
    const by = r + 1;
    svg += `<circle cx="${bx}" cy="${by}" r="${r}" fill="#fff" stroke="${color}" stroke-width="2"/>`;
    svg += glyph(badge, { x: bx - 8, y: by - 8, size: 16, fill: color });
  }
  return svg;
}

function platformSvg(n) {
  const label = String(n);
  const w = 56;
  const h = 44;
  const x = (SIZE - w) / 2;
  const y = SIZE - h - 2;
  const bar = 9;
  const textX = x + bar + (w - bar) / 2;
  const fontSize = label.length > 1 ? 24 : 28;
  return `
    <clipPath id="tag"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7"/></clipPath>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="#fff"/>
    <rect x="${x}" y="${y}" width="${bar}" height="${h}" fill="${COLOR.brand}" clip-path="url(#tag)"/>
    <rect x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${h - 2}" rx="6" fill="none" stroke="${COLOR.border}" stroke-width="2"/>
    <text x="${textX}" y="${y + h / 2}" fill="${COLOR.text}" font-size="${fontSize}" font-weight="700"
      font-family="'Noto Sans JP','Yu Gothic UI','Segoe UI',sans-serif" text-anchor="middle" dominant-baseline="central">${label}</text>`;
}

function page(inner) {
  return `<!doctype html><html><body style="margin:0;background:transparent">
    <svg id="icon" xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${inner}</svg>
  </body></html>`;
}

const icons = [
  ...Object.entries(PINS).map(([file, spec]) => [file, pinSvg(spec)]),
  ...Array.from({ length: PLATFORM_COUNT }, (_, i) => [`bansen_${String(i + 1).padStart(2, "0")}`, platformSvg(i + 1)]),
];

const browser = await chromium.launch();
try {
  const tab = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  for (const [file, inner] of icons) {
    await tab.setContent(page(inner));
    await tab.locator("#icon").screenshot({ path: path.join(OUT_DIR, `${file}.png`), omitBackground: true });
  }
  console.log(`Wrote ${icons.length} marker icons to ${path.relative(ROOT, OUT_DIR)}`);
} finally {
  await browser.close();
}
