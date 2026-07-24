// Subscribes the authoring app to the server's /api/events stream so packages
// pushed from RevitGeoSuite appear in the scene without a reload. Reconnects
// with capped exponential backoff; de-duplicates by packageId (the same event
// can arrive again after a reconnect).

export function connectPackageEvents({ onPackage, eventsUrl = "/api/events" }) {
  let source = null;
  let retryMs = 1_000;
  let closed = false;
  let retryTimer = null;
  const seenPackageIds = new Set();

  function connect() {
    if (closed) return;
    source = new EventSource(eventsUrl);

    source.onopen = () => {
      retryMs = 1_000;
    };

    source.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data?.type !== "package-received" || !data.packageId) return;
      if (seenPackageIds.has(data.packageId)) return;
      seenPackageIds.add(data.packageId);
      onPackage(data);
    };

    source.onerror = () => {
      source.close();
      retryTimer = setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 30_000);
    };
  }

  connect();
  return function disconnect() {
    closed = true;
    if (retryTimer) clearTimeout(retryTimer);
    source?.close();
  };
}
