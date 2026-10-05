import { useEffect, useSyncExternalStore } from "react";
import { api, mutation } from "./api";
export type User = {
  id: string;
  email: string;
  name: string;
  username: string;
  bio: string;
  hue: number;
  interests: string[];
  createdAt: number;
  role: "user" | "moderator" | "admin" | "owner";
  email_verified: boolean;
  mfa_enabled: boolean;
  plan: "free" | "premium";
  subscription_ends_at: number | null;
};
export const AUTH_EVENT = "lumi:auth";
let me: User | null = null;
let ready = false;
let pending: Promise<void> | null = null;
let revision = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function publish(user: User | null) {
  if (ready && JSON.stringify(me) === JSON.stringify(user)) return;
  const changed = me?.id !== user?.id;
  me = user;
  ready = true;
  if (changed && typeof window !== "undefined")
    window.dispatchEvent(new Event("lumi:account-changed"));
  listeners.forEach((fn) => fn());
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(AUTH_EVENT));
}
export async function refreshUser() {
  if (pending) return pending;
  const version = revision;
  pending = api<User | null>("/me")
    .then((user) => {
      if (version === revision) publish(user);
    })
    .catch(() => {
      if (version === revision) publish(null);
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
function useSession() {
  useEffect(() => {
    if (!ready) void refreshUser();
    const focus = () => {
      void refreshUser();
    };
    const changed = (e: StorageEvent) => {
      if (e.key === "lumi:session-change") void refreshUser();
    };
    window.addEventListener("focus", focus);
    window.addEventListener("storage", changed);
    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("storage", changed);
    };
  }, []);
}
function notifyTabs() {
  try {
    localStorage.setItem("lumi:session-change", String(Date.now()));
  } catch {}
}
export function useUser() {
  useSession();
  return useSyncExternalStore(
    subscribe,
    () => me,
    () => null,
  );
}
export function useAuthReady() {
  useSession();
  return useSyncExternalStore(
    subscribe,
    () => ready,
    () => false,
  );
}
export const currentUser = () => me;
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const isEmail = (email: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
export const isUsername = (username: string) =>
  /^[a-z0-9_.]{3,20}$/.test(username);
export async function signUp(input: {
  email: string;
  password: string;
  name: string;
  username: string;
  hue: number;
  interests: string[];
}) {
  const user = await api<User>(
    "/auth/register",
    mutation({ ...input, email: normalizeEmail(input.email) }),
  );
  revision++;
  publish(user);
  notifyTabs();
  return user;
}
export async function signIn(
  email: string,
  password: string,
  totpCode?: string,
) {
  const user = await api<User>(
    "/auth/login",
    mutation({
      email: normalizeEmail(email),
      password,
      ...(totpCode ? { totp_code: totpCode } : {}),
    }),
  );
  revision++;
  publish(user);
  notifyTabs();
  return user;
}
export async function signOut() {
  await api("/auth/logout", mutation());
  revision++;
  publish(null);
  notifyTabs();
}
export async function updateUser(
  patch: Partial<Pick<User, "name" | "username" | "bio" | "hue" | "interests">>,
) {
  const user = await api<User>("/me", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  publish(user);
  return user;
}
export function enterAsGuest() {
  document.cookie = "rb_guest=1; path=/; max-age=31536000; samesite=lax";
}
export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (parts.length > 1 ? [parts[0], parts.at(-1)!] : parts)
      .map((p) => Array.from(p)[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}
