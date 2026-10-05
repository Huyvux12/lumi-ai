// DEMO authentication: accounts live in this browser's localStorage only.
// Passwords are salted + SHA-256 hashed so they are not stored in plain text,
// but this is NOT real security — swap for a real auth provider before launch.

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { readJSON, removeKey, subscribeTo, writeJSON } from "./store";

export type User = {
  email: string;
  name: string;
  username: string;
  bio: string;
  hue: number;
  interests: string[];
  createdAt: number;
};

type Account = User & { pass: string };

const ACCOUNTS = "rb:accounts";
const SESSION = "rb:session";
export const AUTH_EVENT = "rb:auth";

const COOKIE_AGE = 60 * 60 * 24 * 365;

function setCookie(name: string, on: boolean) {
  document.cookie = on
    ? `${name}=1; path=/; max-age=${COOKIE_AGE}; samesite=lax`
    : `${name}=; path=/; max-age=0; samesite=lax`;
}

async function hashPass(email: string, password: string) {
  const data = new TextEncoder().encode(`robobuddy:${email}:${password}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function accounts() {
  return readJSON<Record<string, Account>>(ACCOUNTS, {});
}

const strip = (acc: Account): User => {
  const user: Partial<Account> = { ...acc };
  delete user.pass;
  return user as User;
};

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

export function isEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());
}

export function isUsername(u: string) {
  return /^[a-z0-9_.]{3,20}$/.test(u);
}

export function emailTaken(email: string) {
  return normalizeEmail(email) in accounts();
}

export function usernameTaken(username: string, exceptEmail?: string) {
  return Object.values(accounts()).some((a) => a.username === username && a.email !== exceptEmail);
}

export async function signUp(input: {
  email: string;
  password: string;
  name: string;
  username: string;
  hue: number;
  interests: string[];
}): Promise<User> {
  const email = normalizeEmail(input.email);
  const all = accounts();
  if (all[email]) throw new Error("Email này đã được đăng ký.");
  if (usernameTaken(input.username)) throw new Error("Tên người dùng đã có người dùng.");
  const account: Account = {
    email,
    name: input.name.trim(),
    username: input.username,
    bio: "",
    hue: input.hue,
    interests: input.interests,
    createdAt: Date.now(),
    pass: await hashPass(email, input.password),
  };
  writeJSON(ACCOUNTS, { ...all, [email]: account });
  startSession(email);
  return strip(account);
}

export async function signIn(emailRaw: string, password: string): Promise<User> {
  const email = normalizeEmail(emailRaw);
  const account = accounts()[email];
  if (!account || account.pass !== (await hashPass(email, password))) {
    throw new Error("Email hoặc mật khẩu không đúng.");
  }
  startSession(email);
  return strip(account);
}

function startSession(email: string) {
  setCookie("rb_session", true);
  writeJSON(SESSION, email, AUTH_EVENT);
}

export function signOut() {
  setCookie("rb_session", false);
  removeKey(SESSION, AUTH_EVENT);
}

/** Lets visitors browse the catalogue from the landing page without an account. */
export function enterAsGuest() {
  setCookie("rb_guest", true);
}

export function currentUser(): User | null {
  const email = readJSON<string | null>(SESSION, null);
  if (!email) return null;
  const account = accounts()[email];
  return account ? strip(account) : null;
}

export function updateUser(patch: Partial<Pick<User, "name" | "username" | "bio" | "hue" | "interests">>) {
  const me = currentUser();
  if (!me) throw new Error("Bạn chưa đăng nhập.");
  if (patch.username && usernameTaken(patch.username, me.email)) {
    throw new Error("Tên người dùng đã có người dùng.");
  }
  const all = accounts();
  all[me.email] = { ...all[me.email], ...patch };
  writeJSON(ACCOUNTS, all, AUTH_EVENT);
}

const subscribe = subscribeTo(AUTH_EVENT);
const snapshot = () => JSON.stringify(currentUser());

/** Signed-in user, or null. Always null during SSR/hydration (pair with useHydrated). */
export function useUser(): User | null {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "null");
  // The proxy routes on the cookie; restore it if storage says we're signed in
  // but the cookie expired or was cleared, otherwise "/" bounces back to /welcome.
  useEffect(() => {
    if (raw !== "null" && !/(?:^|;\s*)rb_session=1/.test(document.cookie)) setCookie("rb_session", true);
  }, [raw]);
  return useMemo(() => JSON.parse(raw) as User | null, [raw]);
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const pick = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
  return pick.map((p) => Array.from(p)[0]?.toUpperCase() ?? "").join("") || "?";
}
