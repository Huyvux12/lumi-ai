import type { Character } from "@/lib/data";
import type { ChatMessage } from "./persona";

export type { ChatMessage };

/** Chat service boundary: streams a character reply from the server route. */
export async function streamReply(
  params: { characterId: string; character?: Character; sceneId?: string; messages: ChatMessage[] },
  onChunk: (text: string) => void,
  signal?: AbortSignal,
) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = `Lỗi ${res.status}`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {}
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(decoder.decode(value, { stream: true }));
  }
  return res.headers.get("X-Chat-Mode") ?? "live";
}

// ---- local persistence (per-viewer only) ----
const key = (id: string, scene?: string) => `rb:chat:${id}${scene ? `:${scene}` : ""}`;
const RECENT = "rb:recent";

export function loadHistory(id: string, scene?: string): ChatMessage[] | null {
  try {
    const raw = localStorage.getItem(key(id, scene));
    return raw ? (JSON.parse(raw) as ChatMessage[]) : null;
  } catch {
    return null;
  }
}

export function saveHistory(id: string, scene: string | undefined, msgs: ChatMessage[]) {
  try {
    localStorage.setItem(key(id, scene), JSON.stringify(msgs));
    const recent = loadRecent().filter((r) => r !== id);
    localStorage.setItem(RECENT, JSON.stringify([id, ...recent].slice(0, 8)));
    window.dispatchEvent(new Event("rb:recent"));
  } catch {}
}

export function clearHistory(id: string, scene?: string) {
  try {
    localStorage.removeItem(key(id, scene));
  } catch {}
}

export function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT) ?? "[]");
  } catch {
    return [];
  }
}
