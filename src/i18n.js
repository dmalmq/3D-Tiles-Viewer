/**
 * Lightweight i18n: English/Japanese with `{name}` interpolation.
 *
 *   import { t, setLanguage, getLanguage, onLanguageChange, applyTranslationsToDom } from "./i18n.js";
 *
 * Static markup uses these attributes (any combination on one element):
 *   data-i18n="key"             → element.textContent
 *   data-i18n-html="key"        → element.innerHTML
 *   data-i18n-title="key"       → element.title
 *   data-i18n-placeholder="key" → element.placeholder
 *   data-i18n-aria-label="key"  → element.aria-label
 *
 * Dynamic UI calls t("key", { name: value }). Render functions can subscribe via
 * onLanguageChange(fn) so they re-render when the language flips.
 */

import { MESSAGES } from "./i18nStrings.js";

let current = detectInitialLanguage();
const listeners = new Set();

function detectInitialLanguage() {
  const saved = localStorage.getItem("language");
  if (saved === "en" || saved === "ja") return saved;
  const nav = (navigator.language || "en").toLowerCase();
  return nav.startsWith("ja") ? "ja" : "en";
}

export function getLanguage() {
  return current;
}

export function t(key, params) {
  const dict = MESSAGES[current] || MESSAGES.en;
  let s = dict[key];
  if (s == null) s = MESSAGES.en[key];
  if (s == null) s = key;
  if (params) {
    s = s.replace(/\{(\w+)\}/g, (_, k) =>
      params[k] != null ? String(params[k]) : ""
    );
  }
  return s;
}

export function setLanguage(lang) {
  if (lang !== "en" && lang !== "ja") return;
  current = lang;
  localStorage.setItem("language", lang);
  document.documentElement.setAttribute("data-language", lang);
  applyTranslationsToDom(document.body);
  for (const fn of listeners) {
    try { fn(); } catch (e) { console.warn("language listener failed:", e); }
  }
}

export function onLanguageChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function applyTranslationsToDom(root) {
  if (!root) return;
  const r = root;
  for (const el of r.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.getAttribute("data-i18n"));
  }
  for (const el of r.querySelectorAll("[data-i18n-html]")) {
    el.innerHTML = t(el.getAttribute("data-i18n-html"));
  }
  for (const el of r.querySelectorAll("[data-i18n-title]")) {
    el.title = t(el.getAttribute("data-i18n-title"));
  }
  for (const el of r.querySelectorAll("[data-i18n-placeholder]")) {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
  }
  for (const el of r.querySelectorAll("[data-i18n-aria-label]")) {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria-label")));
  }
}
