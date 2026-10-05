// Tiny localStorage-backed stores shared by auth, user characters and chat history.
// Everything here is per-browser demo state: no server, no real accounts.

import { useSyncExternalStore } from "react";

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown, event?: string) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
  if (event) window.dispatchEvent(new Event(event));
}

export function removeKey(key: string, event?: string) {
  try {
    localStorage.removeItem(key);
  } catch {}
  if (event) window.dispatchEvent(new Event(event));
}

/** Subscribe to one of our custom events plus cross-tab `storage` events. */
export function subscribeTo(event: string) {
  return (cb: () => void) => {
    window.addEventListener(event, cb);
    window.addEventListener("storage", cb);
    return () => {
      window.removeEventListener(event, cb);
      window.removeEventListener("storage", cb);
    };
  };
}

const noopSubscribe = () => () => {};

/** false during SSR + hydration, true afterwards — for client-only (localStorage) UI. */
export function useHydrated() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
