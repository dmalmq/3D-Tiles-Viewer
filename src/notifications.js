// Toast notifications. Replaces silent console.warn or blocking alert() for
// recoverable errors and informational messages.
//
// Usage:
//   notifyUser("error", "alert.failedLoad", { message: e.message });
//   notifyUser("warn", "warning.somethingOff");
//   notifyUser("info", "info.linkInspectionDone");
//
// The `key` is an i18n key resolved through the supplied `translate` function.
// Pass a string in `text` instead if the message is dynamic / not i18n'd.

import { t } from "./i18n.js";

const SEVERITIES = new Set(["info", "warn", "error"]);
const DEFAULT_TIMEOUT_MS = { info: 4_000, warn: 6_000, error: 8_000 };
const CONTAINER_ID = "notificationContainer";

let containerEl = null;

function ensureContainer() {
  if (containerEl && containerEl.isConnected) return containerEl;
  containerEl = document.getElementById(CONTAINER_ID);
  if (!containerEl) {
    containerEl = document.createElement("div");
    containerEl.id = CONTAINER_ID;
    document.body.appendChild(containerEl);
  }
  return containerEl;
}

export function notifyUser(severity, keyOrOptions, params) {
  const opts =
    typeof keyOrOptions === "string"
      ? { key: keyOrOptions, params }
      : keyOrOptions ?? {};
  if (!SEVERITIES.has(severity)) severity = "info";

  const message = opts.text ?? (opts.key ? t(opts.key, opts.params) : "");
  if (!message) return;

  const container = ensureContainer();
  const toast = document.createElement("div");
  toast.className = `notification notification-${severity}`;
  toast.setAttribute("role", severity === "error" ? "alert" : "status");
  toast.setAttribute("aria-live", severity === "error" ? "assertive" : "polite");

  const text = document.createElement("span");
  text.className = "notification-text";
  text.textContent = message;
  toast.appendChild(text);

  // Optional action button (e.g. "Undo" after a package import).
  if (opts.action?.label && typeof opts.action.onClick === "function") {
    const action = document.createElement("button");
    action.className = "notification-action";
    action.type = "button";
    action.textContent = opts.action.label;
    action.addEventListener("click", () => {
      removeToast(toast);
      opts.action.onClick();
    });
    toast.appendChild(action);
  }

  const close = document.createElement("button");
  close.className = "notification-close";
  close.type = "button";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "×";
  close.addEventListener("click", () => removeToast(toast));
  toast.appendChild(close);

  container.appendChild(toast);

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS[severity];
  if (timeoutMs > 0) {
    setTimeout(() => removeToast(toast), timeoutMs);
  }

  return toast;
}

function removeToast(toast) {
  if (!toast || !toast.parentNode) return;
  toast.classList.add("notification-leaving");
  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 200);
}

export function clearNotifications() {
  if (!containerEl) return;
  while (containerEl.firstChild) containerEl.removeChild(containerEl.firstChild);
}
