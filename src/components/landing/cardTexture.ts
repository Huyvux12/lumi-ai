import * as THREE from "three";
import { formatCount, type Character } from "@/lib/data";

export const CARD_W = 400;
export const CARD_H = 560;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loadSvg(svg: string, size: number): Promise<HTMLImageElement | null> {
  const markup = svg.replace("<svg", `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"`);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
}

function loadUrl(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxW && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else line = next;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    let last = lines[maxLines - 1];
    while (ctx.measureText(`${last}…`).width > maxW && last.length) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

/** Paints a character card (portrait + name + tagline) to a canvas texture. */
export async function makeCardTexture(c: Character, svg: string | undefined, font: string) {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d")!;
  const h = c.hue;
  const pad = 20;
  const R = 34;

  // body
  roundRect(ctx, 2, 2, CARD_W - 4, CARD_H - 4, R);
  const bg = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  bg.addColorStop(0, `hsl(${h} 55% 30%)`);
  bg.addColorStop(0.55, `hsl(${(h + 30) % 360} 35% 14%)`);
  bg.addColorStop(1, "#0d0d14");
  ctx.fillStyle = bg;
  ctx.fill();

  // portrait
  const img = c.image ? await loadUrl(c.image) : svg ? await loadSvg(svg, CARD_W - pad * 2) : null;
  ctx.save();
  roundRect(ctx, pad, pad, CARD_W - pad * 2, CARD_W - pad * 2, R - 12);
  ctx.clip();
  if (img) ctx.drawImage(img, pad, pad, CARD_W - pad * 2, CARD_W - pad * 2);
  else {
    ctx.fillStyle = `hsl(${h} 50% 35%)`;
    ctx.fillRect(pad, pad, CARD_W, CARD_W);
  }
  const fade = ctx.createLinearGradient(0, CARD_W * 0.55, 0, CARD_W - pad);
  fade.addColorStop(0, "rgba(10,10,16,0)");
  fade.addColorStop(1, "rgba(10,10,16,0.85)");
  ctx.fillStyle = fade;
  ctx.fillRect(pad, pad, CARD_W, CARD_W);
  ctx.restore();

  // chat count chip
  ctx.font = `600 17px ${font}`;
  const chip = `💬 ${formatCount(c.chats)}`;
  const cw = ctx.measureText(chip).width + 22;
  roundRect(ctx, CARD_W - pad - 12 - cw, pad + 12, cw, 32, 16);
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.fillText(chip, CARD_W - pad - 12 - cw + 11, pad + 29);

  // name
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 34px ${font}`;
  let name = c.name;
  while (ctx.measureText(name).width > CARD_W - pad * 2 - 8 && name.length > 3) name = name.slice(0, -1);
  if (name !== c.name) name = `${name.slice(0, -1)}…`;
  ctx.fillText(name, pad + 4, CARD_W - pad - 14);

  // tagline
  ctx.font = `400 21px ${font}`;
  ctx.fillStyle = "rgba(235,235,255,0.72)";
  wrap(ctx, c.tagline, CARD_W - pad * 2 - 8, 2).forEach((l, i) => ctx.fillText(l, pad + 4, CARD_W + 26 + i * 28));

  // tags
  ctx.font = `600 16px ${font}`;
  let x = pad + 4;
  for (const t of c.tags.slice(0, 2)) {
    const w = ctx.measureText(t).width + 20;
    roundRect(ctx, x, CARD_H - pad - 40, w, 28, 14);
    ctx.fillStyle = `hsl(${h} 70% 65% / 0.22)`;
    ctx.fill();
    ctx.fillStyle = `hsl(${h} 90% 85%)`;
    ctx.fillText(t, x + 10, CARD_H - pad - 20);
    x += w + 8;
  }

  // rim light
  roundRect(ctx, 2, 2, CARD_W - 4, CARD_H - 4, R);
  const rim = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  rim.addColorStop(0, `hsl(${h} 95% 80% / 0.95)`);
  rim.addColorStop(0.5, "rgba(255,255,255,0.12)");
  rim.addColorStop(1, `hsl(${(h + 60) % 360} 95% 75% / 0.8)`);
  ctx.lineWidth = 3;
  ctx.strokeStyle = rim;
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

let glow: THREE.CanvasTexture | null = null;
/** Soft radial sprite used for halos, sparks and flashes. */
export function glowTexture() {
  if (glow) return glow;
  const s = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.2, "rgba(255,255,255,0.55)");
  g.addColorStop(0.5, "rgba(255,255,255,0.12)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  glow = new THREE.CanvasTexture(canvas);
  return glow;
}

let back: THREE.CanvasTexture | null = null;
/** Neutral card back (tinted per card via material color). */
export function cardBackTexture() {
  if (back) return back;
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W / 2;
  canvas.height = CARD_H / 2;
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;
  roundRect(ctx, 1, 1, W - 2, H - 2, 17);
  const bg = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, H * 0.7);
  bg.addColorStop(0, "rgb(120,120,140)");
  bg.addColorStop(1, "rgb(28,28,38)");
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let i = -H; i < W + H; i += 14) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i - H, H);
    ctx.stroke();
  }
  ctx.restore();
  // four-point star
  ctx.translate(W / 2, H / 2);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 ? 9 : 34;
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  roundRect(ctx, 1.5, 1.5, W - 3, H - 3, 17);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.stroke();
  back = new THREE.CanvasTexture(canvas);
  back.colorSpace = THREE.SRGBColorSpace;
  return back;
}
