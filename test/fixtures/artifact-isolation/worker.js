// A valid service worker; sandboxing, not invalid worker code, must refuse it.
self.addEventListener("install", () => self.skipWaiting());
