import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getCharacter, type Character } from "./data";
import { api } from "./api";
import { currentUser, useUser } from "./auth";
export type UserCharacter = Character & {
  owner: string;
  createdAt: number;
  updatedAt: number;
  visibility?: "private" | "public";
  status?: string;
  voice_id?: string;
};
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
let chars: UserCharacter[] = [];
let account: string | null | undefined;
let loaded = false;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((f) => f());
  window.dispatchEvent(new Event(CHARS_EVENT));
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function loadUserChars() {
  return chars;
}
export function getUserChar(id: string) {
  return chars.find((c) => c.id === id);
}
export function resolveCharacter(id: string): Character | undefined {
  return getUserChar(id) ?? getCharacter(id);
}
export async function refreshCharacters() {
  const id = currentUser()?.id ?? null;
  if (account !== id) {
    account = id;
    chars = [];
    loaded = false;
    pending = null;
    notify();
  }
  if (pending) return pending;
  pending = api<UserCharacter[]>("/characters")
    .then((list) => {
      if (account === id) {
        chars = list;
        loaded = true;
        notify();
      }
    })
    .catch(() => {
      loaded = true;
      notify();
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
export async function fetchCharacter(id: string) {
  const accountId = currentUser()?.id;
  const c = await api<UserCharacter>(`/characters/${encodeURIComponent(id)}`);
  if (accountId !== currentUser()?.id) return c;
  chars = [c, ...chars.filter((x) => x.id !== c.id)];
  notify();
  return c;
}
export async function saveUserChar(c: UserCharacter) {
  const { name, tagline, description, persona, greeting, tags, hue, seed } = c;
  const body = {
    name,
    tagline,
    description,
    persona,
    greeting,
    tags,
    hue,
    seed: seed ?? c.id,
    visibility: c.visibility ?? "private",
    voice_id: c.voice_id ?? "kore-warm",
  };
  const exists = chars.some((x) => x.id === c.id);
  const saved = await api<UserCharacter>(
    exists ? `/characters/${c.id}` : "/characters",
    { method: exists ? "PATCH" : "POST", body: JSON.stringify(body) },
  );
  chars = [saved, ...chars.filter((x) => x.id !== saved.id)];
  notify();
  return saved;
}
export async function deleteUserChar(id: string) {
  await api(`/characters/${id}`, { method: "DELETE" });
  chars = chars.filter((c) => c.id !== id);
  notify();
}
export function useUserChars(owner?: string | null) {
  const user = useUser();
  useEffect(() => {
    void refreshCharacters();
  }, [user?.id]);
  const list = useSyncExternalStore(
    subscribe,
    () => chars,
    () => EMPTY,
  );
  return useMemo(
    () => (owner === undefined ? list : list.filter((c) => c.owner === owner)),
    [list, owner],
  );
}
const EMPTY: UserCharacter[] = [];
export function useCharactersReady() {
  return useSyncExternalStore(
    subscribe,
    () => loaded,
    () => false,
  );
}
export const newCharId = () => `u-${crypto.randomUUID()}`;
export const randomSeed = () => Math.random().toString(36).slice(2, 10);
export function markNew(id: string) {
  try {
    sessionStorage.setItem(NEW, id);
  } catch {}
}
export function takeNew() {
  try {
    const id = sessionStorage.getItem(NEW);
    sessionStorage.removeItem(NEW);
    return id;
  } catch {
    return null;
  }
}
export function chatStats() {
  return { conversations: 0, sent: 0 };
}
if (typeof window !== "undefined")
  window.addEventListener("lumi:account-changed", () => {
    account = undefined;
    chars = [];
    loaded = false;
    pending = null;
    notify();
  });
