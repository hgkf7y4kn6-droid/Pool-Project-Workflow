import { useEffect, useState } from "react";
import { Platform } from "react-native";

const RELOADED_KEY = "pool-pm:coi-reloaded";

/**
 * The web SQLite worker needs SharedArrayBuffer, i.e. a cross-origin isolated
 * page. If the host didn't send COOP/COEP headers, install
 * public/coi-serviceworker.js (which adds them) and reload once. Returns false
 * while that reload is pending so the app doesn't open the database early.
 */
export function useCrossOriginIsolation(): boolean {
  const [ready, setReady] = useState(() => !needsServiceWorker());

  useEffect(() => {
    if (ready) return;
    const done = () => setReady(true);
    const reload = () => {
      try {
        sessionStorage.setItem(RELOADED_KEY, "1");
      } catch {
        // Without storage we can't guard against a reload loop, so don't reload.
        return done();
      }
      window.location.reload();
    };
    navigator.serviceWorker
      .register("/coi-serviceworker.js")
      .then((registration) => {
        if (navigator.serviceWorker.controller) return reload();
        const worker = registration.installing ?? registration.waiting ?? registration.active;
        if (!worker) return done();
        if (worker.state === "activated") return reload();
        worker.addEventListener("statechange", () => {
          if (worker.state === "activated") reload();
          else if (worker.state === "redundant") done();
        });
      })
      .catch(done);
  }, [ready]);

  return ready;
}

function needsServiceWorker(): boolean {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  if (window.crossOriginIsolated || !window.isSecureContext || !("serviceWorker" in navigator)) return false;
  try {
    // One attempt per tab: if the reload didn't isolate the page, carry on rather than loop.
    return sessionStorage.getItem(RELOADED_KEY) !== "1";
  } catch {
    return false;
  }
}
