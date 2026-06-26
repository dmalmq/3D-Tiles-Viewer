/**
 * Resolve the public origin for share links returned by POST /api/publish.
 * In dev, the API often runs on :3001 while the editor/viewer is on Vite (:5173).
 */
export function resolvePublishOrigin(req, metadata = {}) {
  const fromClient = metadata?.viewerOrigin;
  if (typeof fromClient === "string" && /^https?:\/\//i.test(fromClient)) {
    return fromClient.replace(/\/$/, "");
  }

  if (process.env.PUBLIC_ORIGIN) {
    return process.env.PUBLIC_ORIGIN.replace(/\/$/, "");
  }

  const forwardedHost = req.get("x-forwarded-host");
  if (forwardedHost) {
    const proto = req.get("x-forwarded-proto") || req.protocol;
    return `${proto}://${forwardedHost}`.replace(/\/$/, "");
  }

  return `${req.protocol}://${req.get("host")}`.replace(/\/$/, "");
}