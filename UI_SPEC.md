# UI_SPEC.md — Pages and behavior

## Routes
| Route | Content |
|---|---|
| `/` | Discover page. Search box at the top plus category chips, then these rails: **Dành cho bạn** (4 cards), **Cảnh** (scene carousel), **Nổi bật** (4 cards, with a "+Lore" tag), **Phổ biến** (4 cards). |
| `/search?q=&tag=` | Grid of search results filtered by name, description, tag or creator. Has an empty state. |
| `/section/[slug]` | Full list for a rail (reached via the chevron next to the rail title). |
| `/scene/[id]` | Scene detail: cover, premise, and the list of characters to pick from; picking one opens `/chat/[characterId]?scene=id`. |
| `/character/[id]` | Profile: large avatar, name, creator, chat count, tags, persona/bio, greeting, a "Bắt đầu trò chuyện" CTA, and similar characters. |
| `/chat/[id]` | Chat with the character. The header shows avatar, name, creator, "Hồ sơ" and "Cuộc trò chuyện mới" (reset). Message list starts with the character's greeting. Composer is a textarea: Enter sends, Shift+Enter adds a newline. Responses stream in. |

## Layout shell
- The left sidebar (desktop) contains: logo, a "+ Tạo nhân vật" button (disabled, labelled "Sắp ra mắt"), Khám phá, Tìm kiếm, and Gần đây (recently chatted characters, from localStorage).
- On mobile the sidebar becomes a top bar with a menu button that opens a drawer (Esc closes it, focus is trapped simply).

## Chat service boundary
- `src/lib/chat/client.ts` calls `POST /api/chat` with `{characterId, sceneId?, messages}` and streams plain text chunks back.
- `src/app/api/chat/route.ts` builds the system prompt from the persona and calls Groq (OpenAI-compatible, `GROQ_API_KEY`, model `GROQ_MODEL`, default `qwen/qwen3.8-27b`), parsing SSE.
  - If the env vars are missing, it falls back to `mockReply` (stays in character, clearly marked as demo).
  - The key is only ever read server-side.
- The conversation is saved per character in localStorage.

## States
- Loading: a typing indicator while waiting for the first token; route `loading.tsx` shows a skeleton.
- Empty: search with no results shows a message plus a "Xóa bộ lọc" button.
- Error: a failed chat shows an inline error bubble with a "Thử lại" button. An unknown id shows `not-found`.

## Accessibility
- Landmarks: `nav`, `main`, and a section per rail with `aria-labelledby`.
- Every card is a single link with an accessible name.
- The carousel is a region with `aria-roledescription="carousel"` and labelled prev/next buttons.
- Visible focus ring (2px accent). Chat log uses `role="log" aria-live="polite"`.
