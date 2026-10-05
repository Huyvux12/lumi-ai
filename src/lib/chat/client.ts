import type { Character } from "@/lib/data";
import { api, ApiError, mutation, requestId } from "@/lib/api";
import { currentUser } from "@/lib/auth";
export type Segment = {
  id: string;
  type: "narration" | "dialogue";
  text: string;
  emotion?: string;
  pace?: string;
  delivery?: string;
};
export type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  segments?: Segment[];
  status?: string;
  created_at?: number;
};
export type Conversation = {
  id: string;
  character_id: string;
  scene_id: string | null;
  updated_at: number;
};
export type TurnEvent = {
  event: string;
  data: {
    id?: string;
    user_message?: ChatMessage;
    segment?: Segment;
    message?: ChatMessage | string;
    mode?: string;
  };
};
export async function streamTurn(
  id: string,
  text: string,
  onEvent: (event: TurnEvent) => void,
  signal: AbortSignal,
  key: string,
  retryMessageId?: string,
) {
  const response = await fetch(`/api/v1/conversations/${id}/turns`, {
    ...mutation(
      { text, ...(retryMessageId ? { retry_message_id: retryMessageId } : {}) },
      key,
    ),
    headers: {
      "Content-Type": "application/json",
      "X-Lumi-Request": "1",
      "Idempotency-Key": key,
    },
    signal,
    credentials: "same-origin",
  });
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      body.message || "Không thể nhận phản hồi.",
      body.code || "REQUEST_FAILED",
      response.status,
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  function parse() {
    let index;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      let name = "message";
      const data: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) name = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length)
        onEvent({ event: name, data: JSON.parse(data.join("\n")) });
    }
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      parse();
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      buffer += "\n\n";
      parse();
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
// Draft preview is authenticated and metered by Python; it cannot supply a system prompt.
export async function streamReply(
  params: {
    characterId: string;
    character?: Character;
    sceneId?: string;
    messages: ChatMessage[];
  },
  onChunk: (text: string) => void,
  signal?: AbortSignal,
) {
  if (!params.character) throw new Error("Thiếu hồ sơ nhân vật thử nghiệm.");
  const { name, tagline, description, persona, greeting, tags, hue, seed } =
    params.character;
  const result = await api<{ content: string; mode: string }>("/chat/preview", {
    ...mutation(
      {
        character: {
          name,
          tagline,
          description,
          persona,
          greeting,
          tags,
          hue,
          seed: seed ?? "preview",
        },
        text:
          params.messages.findLast((m) => m.role === "user")?.content ??
          "Xin chào",
      },
      requestId(),
    ),
    signal,
  });
  onChunk(result.content);
  return result.mode;
}
let recent: string[] = [];
export const loadRecent = () => recent;
export async function refreshRecent() {
  const account = currentUser()?.id;
  if (!account) {
    recent = [];
    window.dispatchEvent(new Event("rb:recent"));
    return;
  }
  try {
    const list = await api<Conversation[]>("/conversations");
    if (currentUser()?.id === account) {
      recent = Array.from(new Set(list.map((c) => c.character_id))).slice(0, 8);
      window.dispatchEvent(new Event("rb:recent"));
    }
  } catch {}
}
if (typeof window !== "undefined")
  window.addEventListener("lumi:account-changed", () => {
    recent = [];
    window.dispatchEvent(new Event("rb:recent"));
  });
