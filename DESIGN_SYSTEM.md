# DESIGN_SYSTEM.md — lumi.ai (AI character discovery)

Source of truth: `reference/character-discovery.png` (structure and feel only; all content is fictional).

## Color tokens (defined in `src/app/globals.css` → `@theme`)
| Token | Value | Use |
|---|---|---|
| `canvas` | `#18181b` | page background (dark charcoal, not pure black) |
| `sidebar` | `#131316` | left navigation panel |
| `surface` | `#222226` | cards (for-you / featured / popular) |
| `surface-2` | `#2c2c31` | hover state, inputs, chat bubbles (character) |
| `border` | `#2f2f35` | subtle 1px separators |
| `text` | `#f4f4f5` | primary text: names, headings |
| `text-2` | `#a1a1aa` | creator line, meta, chat count |
| `text-3` | `#71717a` | placeholder, disabled |
| `accent` | `#8ab4ff` | links, "+Lore" chip text, focus ring |
| `accent-bg` | `#26324a` | chip background |
| `user-bubble` | `#3b3b43` | user chat bubble |
| `danger` | `#f87171` | error states |

Contrast: `text` on `surface` ≈ 14:1, `text-2` on `surface` ≈ 6.5:1 (AA).

## Typography
- Font: Geist Sans (via `next/font`), fallback system sans.
- Section title: 17px / semibold, with a chevron-right that links to the full list.
- Card name: 14px / semibold. Creator: 12px / text-2. Description: 13px / text, clamped to 2 lines. Meta: 12px / text-2.
- Chat message: 15px / 1.55 line-height.

## Spacing, radius, shadow
- 4px base scale. Page gutter: 16px on mobile, 24px on tablet, 56px on desktop (matching the screenshot).
- Card padding: 16px. Gap between cards: 12–16px. Gap between rails: 32px.
- Radius: horizontal card 16px; card image 12px; scene cover 16px; chip 6px; pill/input 999px.
- Shadow: none at rest (flat surfaces, as in the reference). On hover, the surface steps up to `surface-2`, with a subtle `0 8px 24px rgb(0 0 0 / .35)` on scene covers only.

## Components
- **CharacterCard (horizontal):** 112×112 cover on the left, text column on the right. Rows: name, "Người thực hiện @creator", 2-line description, optional tag chips, and a chat count with a speech-bubble icon. Height is about 144px.
- **SceneCard (vertical):** 200×280 (5:7) cover with a gradient scrim at the bottom. Contains the title (2 lines), a "Chọn nhân vật" pill with an avatar, and a corner icon button. The creator line sits under the card.
- **Avatar art:** deterministic SVG portraits (gradient background plus a stylized silhouette) generated from a seed. No external images, so nothing can break or shift layout.

## Motion (Motion library + CSS)
- Card hover: background colour fades in 150ms; the cover scales to 1.04 over 250ms.
- Carousel: native scroll-snap with pointer drag, prev/next buttons, and arrow keys when focused.
- Route entrance: content fades in and moves up 8px over 200ms.
- Chat: new messages fade/slide in over 180ms, plus a typing indicator (three dots).
- `prefers-reduced-motion: reduce` turns off transforms and smooth scrolling (global CSS plus `MotionConfig reducedMotion="user"`).

## Breakpoints
- `<640px`: the sidebar becomes a top bar with a drawer. Rails scroll horizontally with cards at 85vw width.
- `640–1023px`: 2-column grid for the card rails.
- `≥1024px`: sidebar at 240px fixed; 4-column rails (`xl`), 3 columns at `lg`.
