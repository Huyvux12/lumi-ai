import { getCharacter, getScene, type Character } from "@/lib/data";
import { buildSystemPrompt, mockReply, type ChatMessage } from "@/lib/chat/persona";

// Server-only: the API key never reaches the browser. Groq speaks the OpenAI API.
const BASE_URL = "https://api.groq.com/openai/v1";
const API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.GROQ_MODEL ?? "qwen/qwen3.8-27b";
// Qwen thinks before answering by default; roleplay wants the fast, direct reply.
const MODEL_OPTIONS = MODEL.startsWith("qwen/") ? { reasoning_effort: "none" } : {};

const MAX_HISTORY = 30;
const MAX_CHARS = 4000;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * User-created characters live in the visitor's browser, so the client sends the
 * character sheet along. Only ids with the `u-` prefix are accepted this way, and
 * every field is length-capped — built-in characters always come from server data.
 */
function customCharacter(id: string, raw: unknown): Character | undefined {
  if (!id.startsWith("u-") || !raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const c: Character = {
    id: id.slice(0, 60),
    name: str(r.name, 40),
    creator: str(r.creator, 30) || "ban",
    tagline: str(r.tagline, 90),
    description: str(r.description, 600),
    persona: str(r.persona, 1200),
    greeting: str(r.greeting, 600),
    tags: Array.isArray(r.tags) ? r.tags.slice(0, 4).map((t) => str(t, 24)).filter(Boolean) : [],
    chats: 0,
    hue: typeof r.hue === "number" ? r.hue % 360 : 220,
  };
  return c.name && c.persona && c.greeting ? c : undefined;
}

export async function POST(request: Request) {
  let body: { characterId?: string; character?: unknown; sceneId?: string; messages?: ChatMessage[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const character = body.characterId
    ? (getCharacter(body.characterId) ?? customCharacter(body.characterId, body.character))
    : undefined;
  if (!character) return Response.json({ error: "Unknown character" }, { status: 404 });
  const scene = body.sceneId ? getScene(body.sceneId) : undefined;

  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));

  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return Response.json({ error: "Last message must be from user" }, { status: 400 });
  }

  const encoder = new TextEncoder();

  // Demo fallback when the LLM provider is not configured.
  if (!API_KEY) {
    const text = mockReply(character, messages[messages.length - 1].content);
    const stream = new ReadableStream({
      async start(controller) {
        for (const word of text.split(/(\s+)/)) {
          controller.enqueue(encoder.encode(word));
          await new Promise((r) => setTimeout(r, 25));
        }
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Chat-Mode": "demo" },
    });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        ...MODEL_OPTIONS,
        stream: true,
        temperature: 0.9,
        max_tokens: 600,
        messages: [
          { role: "system", content: buildSystemPrompt(character, scene) },
          { role: "assistant", content: character.greeting },
          ...messages,
        ],
      }),
      signal: request.signal,
    });
  } catch {
    return Response.json({ error: "Không kết nối được tới mô hình AI." }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    console.error("LLM upstream error", upstream.status);
    return Response.json(
      { error: `Mô hình AI trả lỗi (${upstream.status}).` },
      { status: 502 },
    );
  }

  // Convert OpenAI-style SSE into a plain text stream.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const stream = new ReadableStream({
    async start(controller) {
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const json = JSON.parse(data);
              const delta: string | undefined = json.choices?.[0]?.delta?.content;
              if (delta) controller.enqueue(encoder.encode(delta));
            } catch {
              // ignore keep-alive / partial frames
            }
          }
        }
      } catch (err) {
        controller.error(err);
        return;
      }
      controller.close();
    },
    cancel() {
      reader.cancel();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Chat-Mode": "live" },
  });
}
