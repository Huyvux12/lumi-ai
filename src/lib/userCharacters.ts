// User-created characters (demo: stored in this browser's localStorage).

import { useMemo, useSyncExternalStore } from "react";
import { getCharacter, type Character } from "./data";
import { readJSON, subscribeTo, writeJSON } from "./store";

export type UserCharacter = Character & { owner: string; createdAt: number; updatedAt: number };

const KEY = "rb:user-chars";
const NEW = "rb:new-char";
export const CHARS_EVENT = "rb:chars";

export const LIMITS = {
  name: [2, 40],
  tagline: [10, 90],
  description: [20, 600],
  persona: [30, 1200],
  greeting: [10, 600],
  tags: [1, 4],
} as const;

export function loadUserChars(): UserCharacter[] {
  return readJSON<UserCharacter[]>(KEY, []);
}

export function getUserChar(id: string) {
  return loadUserChars().find((c) => c.id === id);
}

/** Built-in catalogue first, then this browser's creations. Client-only for user chars. */
export function resolveCharacter(id: string): Character | undefined {
  return getCharacter(id) ?? (typeof window === "undefined" ? undefined : getUserChar(id));
}

export function saveUserChar(c: UserCharacter) {
  const all = loadUserChars().filter((o) => o.id !== c.id);
  writeJSON(KEY, [c, ...all], CHARS_EVENT);
}

export function deleteUserChar(id: string) {
  writeJSON(
    KEY,
    loadUserChars().filter((c) => c.id !== id),
    CHARS_EVENT,
  );
  try {
    for (const k of Object.keys(localStorage)) {
      if (k === `rb:chat:${id}` || k.startsWith(`rb:chat:${id}:`)) localStorage.removeItem(k);
    }
    const recent = readJSON<string[]>("rb:recent", []).filter((r) => r !== id);
    writeJSON("rb:recent", recent, "rb:recent");
  } catch {}
}

function slug(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
}

export function newCharId(name: string) {
  return `u-${slug(name) || "nv"}-${Math.random().toString(36).slice(2, 7)}`;
}

export const randomSeed = () => Math.random().toString(36).slice(2, 10);

/** Marks a character as just created so Khám phá can play its "birth" effect once. */
export function markNew(id: string) {
  try {
    sessionStorage.setItem(NEW, id);
  } catch {}
}

export function takeNew(): string | null {
  try {
    const id = sessionStorage.getItem(NEW);
    sessionStorage.removeItem(NEW);
    return id;
  } catch {
    return null;
  }
}

const subscribe = subscribeTo(CHARS_EVENT);
const snapshot = () => localStorage.getItem(KEY) ?? "[]";

export function useUserChars(owner?: string | null) {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "[]");
  return useMemo(() => {
    let list: UserCharacter[] = [];
    try {
      list = JSON.parse(raw);
    } catch {}
    return owner === undefined ? list : list.filter((c) => c.owner === owner);
  }, [raw, owner]);
}

/** Per-browser chat stats for the profile page. */
export function chatStats() {
  let conversations = 0;
  let sent = 0;
  try {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith("rb:chat:")) continue;
      const msgs = readJSON<{ role: string }[]>(k, []);
      conversations++;
      sent += msgs.filter((m) => m.role === "user").length;
    }
  } catch {}
  return { conversations, sent };
}
