"use client";

// The "character universe": Lumi is born from a spark, then dozens of character
// cards spiral out into a 3D orbit. Everything is driven by the shared `stage`
// clock so the DOM overlay (title, CTA, skip) stays in sync.

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, PerformanceMonitor, Sparkles } from "@react-three/drei";
import { Bloom, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import type { Character } from "@/lib/data";
import { cardBackTexture, glowTexture } from "./cardTexture";
import { INTRO, clamp01, easeInOutCubic, easeOutBack, easeOutCubic, easeOutExpo, range, stage, stageTime } from "./stage";

export type SceneProps = {
  cards: Character[];
  textures: Map<string, THREE.Texture> | null;
  onSelect: (index: number) => void;
  onReady: () => void;
  onPoke: () => void;
  active: boolean;
};

/** Live world positions of the cards, written by <Cards>, read by the camera and bubbles. */
const cardPos: THREE.Vector3[] = [];
/** Per-card visibility (1 = normal, <1 = stepped back behind the title). */
const cardFade: number[] = [];

const CARD_H = 1.4;
const CARD_W = CARD_H * (400 / 560);

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Camera distance that keeps the orbit framed on narrow (portrait) screens. */
function farZ(aspect: number) {
  return aspect < 1.1 ? 12 * (1 + (1.1 - aspect) * 1.15) : 12;
}

/* ───────────────────────────── Lumi (3D) ───────────────────────────── */

const bodyVert = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vObjN;
  void main() {
    vObjN = normal;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const bodyFrag = /* glsl */ `
  uniform float uGlow;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vObjN;
  void main() {
    vec3 n = normalize(vN);
    vec3 L = normalize(vec3(-0.55, 0.7, 0.55));
    float d = dot(n, L) * 0.5 + 0.5;
    vec3 c0 = vec3(0.36, 0.24, 0.80);
    vec3 c1 = vec3(0.54, 0.49, 1.00);
    vec3 c2 = vec3(0.66, 0.78, 1.00);
    vec3 c3 = vec3(0.95, 0.97, 1.00);
    vec3 col = mix(c0, c1, smoothstep(0.05, 0.45, d));
    col = mix(col, c2, smoothstep(0.45, 0.78, d));
    col = mix(col, c3, smoothstep(0.84, 1.0, d));
    // Authored in sRGB; the composer works in linear space.
    col = pow(col, vec3(2.2)) * 1.25;
    float fr = pow(1.0 - max(dot(n, normalize(vV)), 0.0), 2.4);
    vec3 rim = mix(vec3(0.55, 0.72, 1.0), vec3(0.96, 0.62, 1.0), vObjN.y * 0.5 + 0.5);
    col += rim * fr * (0.9 + uGlow * 1.2);
    col *= 0.9 + uGlow * 0.25;
    gl_FragColor = vec4(col, 1.0);
  }
`;

function Mascot3D({ onPoke }: { onPoke: () => void }) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const bodyMesh = useRef<THREE.Mesh>(null);
  const eyes = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const wisp = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Sprite>(null);
  const core = useRef<THREE.Sprite>(null);
  const flash = useRef<THREE.Sprite>(null);
  const cheeks = useRef<THREE.Group>(null);
  const blink = useRef({ next: 5.2, until: 0 });
  const look = useRef(new THREE.Vector2());

  const glow = useMemo(() => glowTexture(), []);
  const bodyMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: bodyVert,
        fragmentShader: bodyFrag,
        uniforms: { uGlow: { value: 0 } },
      }),
    [],
  );

  useFrame((_, dt) => {
    const t = stageTime();
    const now = performance.now();
    const g = root.current!;

    // 0–1.8s: a single breathing spark.
    const breath = 0.5 + 0.5 * Math.sin(t * 3.2);
    const sparkIn = easeOutCubic(range(t, 0.1, 0.9));
    const bloomP = range(t, INTRO.bloom, INTRO.bloom + 1.1);
    const grow = bloomP <= 0 ? 0 : easeOutBack(bloomP, 1.6);
    const sparkOut = 1 - range(t, INTRO.bloom, INTRO.bloom + 0.5);

    const c = core.current!;
    c.scale.setScalar((0.22 + breath * 0.1) * sparkIn * (1 + (1 - sparkOut) * 3));
    (c.material as THREE.SpriteMaterial).opacity = sparkIn * sparkOut;

    const f = flash.current!;
    const fp = range(t, INTRO.bloom, INTRO.bloom + 0.9);
    f.scale.setScalar(0.5 + easeOutExpo(fp) * 9);
    (f.material as THREE.SpriteMaterial).opacity = fp > 0 && fp < 1 ? (1 - fp) * 0.9 : 0;

    // Jelly wobble after the bloom, plus a happy jump when poked.
    const wob = Math.exp(-Math.max(0, t - 2.4) * 3.5) * Math.sin((t - 2.4) * 16) * 0.07 * (t > 2.4 ? 1 : 0);
    const jumpT = (now - stage.jumpAt) / 1000;
    const jump = jumpT < 0.9 ? Math.sin((jumpT / 0.9) * Math.PI) : 0;
    const s = Math.max(0.0001, grow);
    const b = body.current!;
    b.scale.set(s * (1 + wob), s * (1 - wob + jump * 0.06), s * (1 + wob));
    b.position.y = (t > 3 ? Math.sin(t * 1.8) * 0.07 : 0) + jump * 0.55;
    b.visible = grow > 0.001;

    (bodyMesh.current!.material as THREE.ShaderMaterial).uniforms.uGlow.value =
      0.35 + 0.25 * Math.sin(t * 2.1) + (1 - range(t, INTRO.bloom, INTRO.bloom + 1.2)) * 0.9 * (t > INTRO.bloom ? 1 : 0);

    const h = halo.current!;
    h.scale.setScalar(Math.max(0.001, (1.2 + 0.4 * breath) * sparkIn + grow * 4.2 + Math.sin(t * 1.3) * 0.15 * grow));
    (h.material as THREE.SpriteMaterial).opacity = 0.55 * sparkIn + 0.1 * grow;

    // Eyes: closed line until 3.0s, then pop open. Natural blinking after.
    const open = t < INTRO.eyes ? 0 : easeOutBack(range(t, INTRO.eyes, INTRO.eyes + 0.35), 2.4);
    const bl = blink.current;
    if (t > bl.next) {
      bl.until = t + 0.14;
      bl.next = t + 2.2 + Math.random() * 3;
    }
    const blinking = t < bl.until && t > INTRO.eyes + 1 ? 0.12 : 1;
    const e = eyes.current!;
    e.scale.y = Math.max(0.08, open * blinking);

    // Gaze: dead-center at the audience during the reveal, then follow the pointer.
    const follow = range(t, 4.8, 5.8);
    look.current.lerp(new THREE.Vector2(stage.pointer.x * follow, stage.pointer.y * follow), 1 - Math.pow(0.001, dt));
    e.position.x = look.current.x * 0.09;
    e.position.y = look.current.y * 0.07;
    g.rotation.y = look.current.x * 0.42;
    g.rotation.x = -look.current.y * 0.28;
    // Grow as the camera pulls back so Lumi stays the hero of the wide shot.
    g.scale.setScalar(1 + 0.4 * easeInOutCubic(range(t, INTRO.burst, INTRO.settle + 0.5)));

    // Wave hello (intro + whenever the CTA asks for it).
    const waveIntro = range(t, INTRO.wave, INTRO.wave + 0.3) * (1 - range(t, 4.4, 4.9));
    const waveLate = (now - stage.waveAt) / 1000;
    const waveCta = waveLate < 2 ? Math.min(1, waveLate * 4) * (1 - range(waveLate, 1.5, 2)) : 0;
    const up = Math.max(waveIntro, waveCta);
    armR.current!.rotation.z = up * (1.05 + Math.sin(t * 13) * 0.4) + Math.sin(t * 1.8 + 1) * 0.08;
    armL.current!.rotation.z = -Math.sin(t * 1.8) * 0.08 - jump * 0.9;

    wisp.current!.rotation.z = Math.sin(t * 2.6) * 0.18;
    wisp.current!.scale.y = 1 + Math.sin(t * 3.4) * 0.08;
    cheeks.current!.scale.setScalar(1 + jump * 0.3);
  });

  return (
    <group ref={root}>
      <sprite ref={halo} scale={0.001}>
        <spriteMaterial map={glow} color="#8ab4ff" transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <sprite ref={core} scale={0.001}>
        <spriteMaterial map={glow} color="#ffffff" transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <sprite ref={flash} scale={0.001}>
        <spriteMaterial
          map={glow}
          color="#c9b8ff"
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          opacity={0}
        />
      </sprite>

      <group
        ref={body}
        scale={0.0001}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onPoke();
        }}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "")}
      >
        <mesh ref={bodyMesh} material={bodyMat}>
          <sphereGeometry args={[1, 64, 48]} />
        </mesh>
        {/* glossy highlight */}
        <mesh position={[-0.36, 0.5, 0.72]} rotation={[0, 0, 0.6]} scale={[0.26, 0.13, 0.06]}>
          <sphereGeometry args={[1, 24, 16]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.45} toneMapped={false} />
        </mesh>
        {/* wisp flame */}
        <group ref={wisp} position={[0.05, 0.95, -0.05]}>
          <mesh position={[0, 0.28, 0]} scale={[0.17, 0.38, 0.17]}>
            <sphereGeometry args={[1, 24, 16]} />
            <meshBasicMaterial color={new THREE.Color("#f0abfc").multiplyScalar(1.6)} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.2, 0]} scale={[0.1, 0.24, 0.1]}>
            <sphereGeometry args={[1, 16, 12]} />
            <meshBasicMaterial color={new THREE.Color("#ffffff").multiplyScalar(2)} toneMapped={false} />
          </mesh>
        </group>
        {/* eyes */}
        <group position={[0, 0.02, 0]}>
          <group ref={eyes} scale={[1, 0.08, 1]}>
            {[-0.3, 0.3].map((x) => (
              <group key={x} position={[x, 0, 0.9]}>
                <mesh scale={[0.15, 0.2, 0.08]}>
                  <sphereGeometry args={[1, 24, 16]} />
                  <meshBasicMaterial color="#1b1336" />
                </mesh>
                <mesh position={[0.05, 0.07, 0.07]} scale={0.055}>
                  <sphereGeometry args={[1, 12, 8]} />
                  <meshBasicMaterial color={new THREE.Color("#ffffff").multiplyScalar(1.6)} toneMapped={false} />
                </mesh>
                <mesh position={[-0.04, -0.07, 0.07]} scale={0.024}>
                  <sphereGeometry args={[1, 8, 6]} />
                  <meshBasicMaterial color="#ffffff" />
                </mesh>
              </group>
            ))}
          </group>
        </group>
        {/* cheeks */}
        <group ref={cheeks}>
          {[-0.56, 0.56].map((x) => (
            <mesh key={x} position={[x, -0.24, 0.76]} rotation={[0, x * 0.9, 0]} scale={[0.15, 0.09, 0.04]}>
              <sphereGeometry args={[1, 16, 12]} />
              <meshBasicMaterial color="#ff8fc7" transparent opacity={0.75} toneMapped={false} />
            </mesh>
          ))}
        </group>
        {/* smile */}
        <mesh position={[0, -0.2, 0.975]} rotation={[0.15, 0, Math.PI]}>
          <torusGeometry args={[0.1, 0.022, 8, 24, Math.PI]} />
          <meshBasicMaterial color="#1b1336" />
        </mesh>
        {/* arms */}
        <group ref={armR} position={[0.86, -0.3, 0.12]}>
          <mesh position={[0.24, 0, 0]} scale={[0.22, 0.17, 0.17]} material={bodyMat}>
            <sphereGeometry args={[1, 24, 16]} />
          </mesh>
        </group>
        <group ref={armL} position={[-0.86, -0.3, 0.12]}>
          <mesh position={[-0.24, 0, 0]} scale={[0.22, 0.17, 0.17]} material={bodyMat}>
            <sphereGeometry args={[1, 24, 16]} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

/* ───────────────────────────── Particles ───────────────────────────── */

const pointsVert = /* glsl */ `
  uniform float uTime;
  uniform float uProgress;
  uniform float uPixel;
  attribute vec3 aDir;
  attribute float aDist;
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aSeed;
  varying vec3 vColor;
  varying float vTw;
  void main() {
    vec3 p = aDir * aDist * uProgress;
    p += vec3(sin(uTime * 0.31 + aSeed * 6.28), cos(uTime * 0.23 + aSeed * 12.0), sin(uTime * 0.19 + aSeed * 3.0)) * 0.35 * uProgress;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixel * (12.0 / -mv.z);
    vColor = aColor;
    vTw = 0.55 + 0.45 * sin(uTime * 2.3 + aSeed * 40.0);
  }
`;

const pointsFrag = /* glsl */ `
  uniform float uAlpha;
  varying vec3 vColor;
  varying float vTw;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    a *= a;
    gl_FragColor = vec4(vColor * 1.8, a * uAlpha * vTw);
  }
`;

type FieldKind = "burst" | "stars";

function PointsField({ kind, count }: { kind: FieldKind; count: number }) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const { gl } = useThree();
  const geo = useMemo(() => {
    const rnd = mulberry(kind === "burst" ? 7 : 11);
    const dir = new Float32Array(count * 3);
    const dist = new Float32Array(count);
    const size = new Float32Array(count);
    const color = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const pos = new Float32Array(count * 3);
    const palette = ["#8ab4ff", "#a78bfa", "#f0abfc", "#ffffff", "#7dd3fc", "#fde68a"].map((c) => new THREE.Color(c));
    for (let i = 0; i < count; i++) {
      const u = rnd() * 2 - 1;
      const th = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      dir.set([r * Math.cos(th), u * (kind === "burst" ? 0.55 : 1), r * Math.sin(th)], i * 3);
      dist[i] = kind === "burst" ? 2 + Math.pow(rnd(), 0.6) * 16 : 35 + rnd() * 40;
      size[i] = kind === "burst" ? 1.2 + rnd() * 3.2 : 4 + rnd() * 9;
      const c = palette[Math.floor(rnd() * (kind === "burst" ? palette.length : 4))];
      color.set([c.r, c.g, c.b], i * 3);
      seed[i] = rnd();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aDir", new THREE.BufferAttribute(dir, 3));
    g.setAttribute("aDist", new THREE.BufferAttribute(dist, 1));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aColor", new THREE.BufferAttribute(color, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    return g;
  }, [count, kind]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uAlpha: { value: 0 },
      uPixel: { value: 1 },
    }),
    [],
  );

  useFrame(() => {
    const t = stageTime();
    const m = mat.current!;
    m.uniforms.uTime.value = t;
    m.uniforms.uPixel.value = gl.getPixelRatio();
    if (kind === "burst") {
      const p = range(t, INTRO.burst, INTRO.burst + 3.2);
      m.uniforms.uProgress.value = 0.02 + easeOutExpo(p);
      m.uniforms.uAlpha.value = t < INTRO.burst ? 0 : 1 - range(t, INTRO.burst + 0.4, INTRO.burst + 3) * 0.45;
    } else {
      m.uniforms.uProgress.value = 1;
      m.uniforms.uAlpha.value = range(t, INTRO.bloom + 0.2, INTRO.burst + 1.5) * 0.9;
    }
  });

  return (
    <points geometry={geo} frustumCulled={false}>
      <shaderMaterial
        ref={mat}
        vertexShader={pointsVert}
        fragmentShader={pointsFrag}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/* ───────────────────────────── Shockwave & orbit rings ───────────────────────────── */

function Shockwaves() {
  const a = useRef<THREE.Mesh>(null);
  const b = useRef<THREE.Mesh>(null);
  const rings = useRef<THREE.Group>(null);
  useFrame(() => {
    const t = stageTime();
    const p = range(t, INTRO.burst, INTRO.burst + 1.4);
    const on = p > 0 && p < 1;
    for (const [m, delay, max] of [
      [a.current!, 0, 12],
      [b.current!, 0.12, 16],
    ] as const) {
      const q = range(t, INTRO.burst + delay, INTRO.burst + delay + 1.4);
      m.visible = on || (q > 0 && q < 1);
      m.scale.setScalar(0.3 + easeOutExpo(q) * max);
      (m.material as THREE.MeshBasicMaterial).opacity = (1 - q) * 0.9;
    }
    const r = rings.current!;
    const rp = easeOutCubic(range(t, INTRO.burst + 0.6, INTRO.settle));
    r.scale.setScalar(0.4 + rp * 0.6);
    r.rotation.y = t * 0.02;
    r.children.forEach((c, i) => {
      ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = rp * (0.16 - i * 0.03);
    });
  });
  return (
    <>
      <mesh ref={a} visible={false}>
        <ringGeometry args={[0.97, 1, 128]} />
        <meshBasicMaterial
          color={new THREE.Color("#c4b5fd").multiplyScalar(2)}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <group rotation={[1.25, 0, -0.12]}>
        <mesh ref={b} visible={false}>
          <ringGeometry args={[0.94, 1, 128]} />
          <meshBasicMaterial
            color={new THREE.Color("#f0abfc").multiplyScalar(1.6)}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
        <group ref={rings}>
          {[5.2, 7, 8.8].map((r) => (
            <mesh key={r} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[r, 0.012, 6, 220]} />
              <meshBasicMaterial
                color="#b4c6ff"
                transparent
                opacity={0}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                toneMapped={false}
              />
            </mesh>
          ))}
        </group>
      </group>
    </>
  );
}

/* ───────────────────────────── Character cards ───────────────────────────── */

type Orbit = {
  r: number;
  theta: number;
  y: number;
  w: number;
  spin: number;
  delay: number;
  tilt: number;
};

const ORBIT_TILT = new THREE.Euler(0.28, 0, -0.1);

function Cards({ cards, textures, onSelect }: Pick<SceneProps, "cards" | "textures" | "onSelect">) {
  const groups = useRef<(THREE.Group | null)[]>([]);
  const glows = useRef<(THREE.Sprite | null)[]>([]);
  const hover = useRef<number[]>(cards.map(() => 0));
  const fronts = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const fade = useRef<number[]>(cards.map(() => 1));
  const ndc = useMemo(() => new THREE.Vector3(), []);
  const { camera } = useThree();
  const glow = useMemo(() => glowTexture(), []);
  const backTex = useMemo(() => cardBackTexture(), []);
  const geo = useMemo(() => new THREE.PlaneGeometry(CARD_W, CARD_H), []);

  const orbits = useMemo<Orbit[]>(() => {
    const rnd = mulberry(42);
    const n = cards.length;
    return cards.map((_, i) => ({
      r: 4.6 + (i % 4) * 1.25 + rnd() * 0.6,
      theta: i * 2.399963 + rnd() * 0.2,
      y: (rnd() - 0.5) * 3.6,
      w: 0.045 + rnd() * 0.03,
      spin: Math.PI * 2 * (1 + Math.round(rnd())),
      delay: INTRO.burst + 0.05 + (i / n) * 1.3,
      tilt: (rnd() - 0.5) * 0.35,
    }));
  }, [cards]);

  const q = useMemo(() => new THREE.Quaternion(), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const obj = useMemo(() => new THREE.Object3D(), []);

  useFrame((_, dt) => {
    const t = stageTime();
    q.setFromEuler(ORBIT_TILT);
    orbits.forEach((o, i) => {
      const g = groups.current[i];
      if (!g) return;
      const p = easeOutCubic(range(t, o.delay, o.delay + 2.3));
      const ang = o.theta + o.w * Math.max(0, t - INTRO.burst) - (1 - p) * 5;
      const rr = o.r * p;
      tmp.set(Math.cos(ang) * rr, o.y * p + Math.sin(t * 0.7 + i) * 0.12 * p, Math.sin(ang) * rr).applyQuaternion(q);
      g.position.copy(tmp);
      (cardPos[i] ??= new THREE.Vector3()).copy(tmp);

      const target = stage.hovered === i ? 1 : 0;
      hover.current[i] += (target - hover.current[i]) * (1 - Math.pow(0.0005, dt));
      const hv = hover.current[i];
      const sc = Math.max(0.0001, easeOutBack(p, 1.4)) * (1 + hv * 0.28);
      g.scale.setScalar(sc);
      g.visible = t > o.delay;

      // Face the camera (readable), with a bit of spin during the burst and a gentle sway after.
      obj.position.copy(tmp);
      obj.lookAt(camera.position);
      g.quaternion.copy(obj.quaternion);
      const sp = easeOutCubic(range(t, o.delay, o.delay + 1.6));
      g.rotateY((1 - sp) * o.spin + Math.sin(t * 0.5 + i) * 0.12 * (1 - hv));
      g.rotateZ(o.tilt * (1 - hv) + Math.sin(t * 0.4 + i * 2) * 0.04);

      // Cards drifting in front of the title (and Lumi) step back so the headline stays legible.
      ndc.copy(tmp).project(camera);
      const inFront = tmp.distanceTo(camera.position) < camera.position.length();
      const ax = Math.abs(ndc.x);
      const overTitle = (ax < 0.62 && ndc.y > -0.9 && ndc.y < 0.2) || (ax < 0.36 && ndc.y >= 0.2 && ndc.y < 0.85);
      const overLogo = ndc.x < -0.55 && ndc.y > 0.62;
      const tooClose = tmp.distanceTo(camera.position) < 3.2;
      const want = t > INTRO.title - 0.5 && !stage.flying && hv < 0.5 && ((inFront && overTitle) || overLogo || tooClose) ? 0.18 : 1;
      fade.current[i] += (want - fade.current[i]) * (1 - Math.pow(0.02, dt));
      const f = fade.current[i];
      cardFade[i] = f;
      const m = fronts.current[i];
      if (m) m.opacity = f;
      g.children.forEach((ch) => {
        if (ch instanceof THREE.Mesh && ch.material !== m) (ch.material as THREE.MeshBasicMaterial).opacity = f;
      });

      const s = glows.current[i];
      if (s) (s.material as THREE.SpriteMaterial).opacity = (0.28 + hv * 0.6) * p * f;
    });
  });

  if (!textures) return null;

  return (
    <group>
      {cards.map((c, i) => (
        <group
          key={`${c.id}-${i}`}
          ref={(el) => {
            groups.current[i] = el;
          }}
          visible={false}
        >
          <sprite
            ref={(el) => {
              glows.current[i] = el;
            }}
            scale={[CARD_W * 2.6, CARD_H * 2.1, 1]}
            position={[0, 0, -0.05]}
          >
            <spriteMaterial
              map={glow}
              color={new THREE.Color(`hsl(${c.hue}, 90%, 62%)`)}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
              opacity={0}
            />
          </sprite>
          <mesh
            geometry={geo}
            onPointerOver={(e) => {
              e.stopPropagation();
              if (stageTime() < INTRO.settle - 1.5 || stage.flying) return;
              stage.hovered = i;
              document.body.style.cursor = "pointer";
            }}
            onPointerOut={() => {
              if (stage.hovered === i) stage.hovered = null;
              document.body.style.cursor = "";
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (stageTime() < INTRO.settle - 1.5 || stage.flying) return;
              document.body.style.cursor = "";
              onSelect(i);
            }}
          >
            <meshBasicMaterial
              ref={(el) => {
                fronts.current[i] = el;
              }}
              map={textures.get(c.id) ?? null}
              transparent
              alphaTest={0.02}
              toneMapped={false}
            />
          </mesh>
          <mesh geometry={geo} rotation={[0, Math.PI, 0]}>
            <meshBasicMaterial
              map={backTex}
              color={new THREE.Color(`hsl(${c.hue}, 85%, 72%)`)}
              transparent
              alphaTest={0.02}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ───────────────────────────── Speech bubbles ───────────────────────────── */

function snippet(greeting: string) {
  const plain = greeting
    .replace(/\*[^*]*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= 62) return plain;
  // Prefer whole sentences; fall back to a word boundary.
  let whole = "";
  for (const s of plain.match(/[^.!?…]+[.!?…]+/g) ?? []) {
    if ((whole + s).trim().length > 62) break;
    whole += s;
  }
  if (whole.trim().length >= 20) return whole.trim();
  const cut = plain.slice(0, 62);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

const SLOTS = 3;

function Bubbles({ cards }: { cards: Character[] }) {
  const [slots, setSlots] = useState<{ card: number; key: string }[]>([]);
  const anchors = useRef<(THREE.Group | null)[]>([]);
  const bubbles = useRef<(HTMLDivElement | null)[]>([]);
  const { camera } = useThree();

  // Every few seconds, a character near the front "speaks".
  useEffect(() => {
    let version = -1;
    const pick = (taken: Set<number>, k: number) => {
      const narrow = window.innerWidth < 640;
      const view = new THREE.Vector3();
      const other = new THREE.Vector3();
      const others = [...taken].filter((i) => cardPos[i]).map((i) => other.copy(cardPos[i]).project(camera).clone());
      const candidates = cardPos
        .map((p, i) => ({ i, p }))
        .filter(({ i, p }) => {
          if (taken.has(i) || !p || (cardFade[i] ?? 1) < 0.9) return false;
          const d = p.distanceTo(camera.position);
          if (d < 4.2) return false;
          view.copy(p).project(camera);
          const ax = Math.abs(view.x);
          const inBand = k === 0 ? view.x < 0 : k === 1 ? view.x > 0 : true;
          // keep clear of the other bubbles (screen space)
          if (others.some((o) => Math.abs(o.x - view.x) < 0.5 && Math.abs(o.y - view.y) < 0.4)) return false;
          // Narrow screens: only cards up top, near the middle, so the bubble never spills off-screen.
          if (narrow) return p.z > 0.5 && view.y > 0.42 && view.y < 0.75 && ax > 0.12 && ax < 0.4;
          return p.z > 0.5 && view.y > 0.02 && view.y < 0.6 && inBand && ax > 0.34 && ax < 0.78;
        });
      if (!candidates.length) return -1;
      return candidates[Math.floor(Math.random() * candidates.length)].i;
    };
    const tick = () => {
      const t = stageTime();
      if (t < INTRO.title + 0.3 || stage.flying) {
        // Replay (timeline seeked back) or flying to a card: clear speech.
        if (stage.flying || version !== -1) {
          version = -1;
          setSlots([]);
        }
        return;
      }
      const v = Math.floor((t - INTRO.title - 0.3) / 1.1);
      if (v === version) return;
      version = v;
      setSlots((prev) => {
        // Intro: pop the first three one by one. Afterwards: rotate one slot every ~4.4s.
        if (v < SLOTS) {
          const taken = new Set(prev.map((s) => s.card));
          const card = pick(taken, v);
          return card < 0 ? prev : [...prev, { card, key: `${v}-${card}` }];
        }
        if (v % 4 !== 0) return prev;
        const k = Math.min((v / 4) % SLOTS, prev.length);
        const taken = new Set(prev.map((s) => s.card));
        const card = pick(taken, k);
        if (card < 0) return prev;
        const next = [...prev];
        next[k] = { card, key: `${v}-${card}` };
        return next;
      });
    };
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [camera]);

  useFrame(() => {
    slots.forEach((s, k) => {
      const a = anchors.current[k];
      const p = cardPos[s.card];
      if (a && p) a.position.set(p.x, p.y + 0.95, p.z);
      // A speaker drifting too close or behind the title quietly hushes.
      const el = bubbles.current[k];
      if (el && p) {
        const ok = stage.mode !== "cta" && (cardFade[s.card] ?? 1) > 0.8 && p.distanceTo(camera.position) > 3.8;
        el.style.opacity = ok ? "" : "0";
      }
    });
  });

  return (
    <>
      {slots.map((s, k) => {
        const c = cards[s.card];
        return (
          <group
            key={k}
            ref={(el) => {
              anchors.current[k] = el;
            }}
          >
            <Html center distanceFactor={9} zIndexRange={[20, 10]} wrapperClass="pointer-events-none">
              <div
                ref={(el) => {
                  bubbles.current[k] = el;
                }}
                className="transition-opacity duration-500"
              >
                <div key={s.key} className="lp-bubble" style={{ "--h": c.hue } as React.CSSProperties}>
                  <span className="lp-bubble-name">{c.name}</span>
                  <span className="lp-bubble-text">{snippet(c.greeting)}</span>
                </div>
              </div>
            </Html>
          </group>
        );
      })}
    </>
  );
}

/* ───────────────────────────── Camera ───────────────────────────── */

function CameraRig() {
  const { camera, size } = useThree();
  const worldObj = useRef<THREE.Object3D | null>(null);
  const look = useRef(new THREE.Vector3());
  const flight = useRef<{
    from: THREE.Vector3;
    fromLook: THREE.Vector3;
  } | null>(null);
  const par = useRef(new THREE.Vector2());
  const modeMix = useRef(0);

  useFrame((state, dt) => {
    const t = stageTime();
    const k = 1 - Math.pow(0.02, dt);
    const aspect = size.width / size.height;
    const far = farZ(aspect);
    const pull = easeInOutCubic(range(t, INTRO.burst - 0.1, INTRO.settle + 0.6));
    modeMix.current += ((stage.mode === "cta" ? 1 : 0) - modeMix.current) * (1 - Math.pow(0.1, dt));
    const m = modeMix.current;

    // Close-up on the spark, then dolly out to reveal the universe.
    const breathe = t < INTRO.burst ? Math.sin(t * 0.8) * 0.05 : 0;
    const baseZ = THREE.MathUtils.lerp(4.7 - easeInOutCubic(range(t, 0, INTRO.burst)) * 0.5 + breathe, far, pull);
    const baseY = THREE.MathUtils.lerp(0, -1.55, pull);
    const z = THREE.MathUtils.lerp(baseZ, far * 0.86, m);
    const y = THREE.MathUtils.lerp(baseY, -1.9, m);

    par.current.lerp(new THREE.Vector2(stage.pointer.x, stage.pointer.y), k);
    const px = par.current.x * range(t, 4.5, 6);
    const py = par.current.y * range(t, 4.5, 6);

    const w = (worldObj.current ??= state.scene.getObjectByName("lp-world") ?? null);
    if (w) {
      w.rotation.y = px * 0.14 + Math.sin(t * 0.1) * 0.03 * pull;
      w.rotation.x = -py * 0.07;
    }

    if (stage.flying) {
      const f = (flight.current ??= {
        from: camera.position.clone(),
        fromLook: look.current.clone(),
      });
      const target = cardPos[stage.flying.index];
      if (target) {
        const wp = target.clone();
        if (w) wp.applyEuler(w.rotation);
        const p = easeInOutCubic(clamp01((performance.now() - stage.flying.at) / 1100));
        const dest = wp.clone().add(f.from.clone().sub(wp).setLength(1.35));
        camera.position.lerpVectors(f.from, dest, p);
        look.current.lerpVectors(f.fromLook, wp, Math.min(1, p * 1.6));
        camera.lookAt(look.current);
        return;
      }
    }
    flight.current = null;

    camera.position.set(px * 0.8, y + py * 0.4, z);
    look.current.set(0, y + 0.05 * pull, 0);
    camera.lookAt(look.current);
  });
  return null;
}

/* ───────────────────────────── Scene root ───────────────────────────── */

function World({
  cards,
  textures,
  onSelect,
  onPoke,
}: Pick<SceneProps, "cards" | "textures" | "onSelect"> & {
  onPoke: () => void;
}) {
  const world = useRef<THREE.Group>(null);
  const dust = useRef<THREE.Group>(null);
  useFrame(() => {
    const t = stageTime();
    const d = dust.current;
    if (d) {
      d.visible = t > INTRO.burst;
      d.scale.setScalar(0.3 + easeOutCubic(range(t, INTRO.burst, INTRO.burst + 2.5)) * 0.7);
    }
  });
  return (
    <>
      <CameraRig />
      <group ref={world} name="lp-world">
        <PointsField kind="stars" count={1400} />
        <PointsField kind="burst" count={900} />
        <group ref={dust}>
          <Sparkles count={140} scale={[22, 12, 22]} size={4} speed={0.35} opacity={0.8} color="#c4b5fd" noise={1.2} />
        </group>
        <Shockwaves />
        <Cards cards={cards} textures={textures} onSelect={onSelect} />
        <Mascot3D onPoke={onPoke} />
        <Bubbles cards={cards} />
      </group>
    </>
  );
}

function Effects({ tier }: { tier: number }) {
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <Bloom mipmapBlur intensity={tier > 0 ? 1.35 : 1.1} luminanceThreshold={0.62} luminanceSmoothing={0.25} radius={0.78} />
      <Vignette offset={0.22} darkness={0.85} eskil={false} />
      <Noise opacity={tier > 0 ? 0.035 : 0} blendFunction={BlendFunction.OVERLAY} />
    </EffectComposer>
  );
}

export default function Scene({ cards, textures, onSelect, onReady, onPoke, active }: SceneProps) {
  const [dpr, setDpr] = useState(1.5);
  const [tier, setTier] = useState(1);
  return (
    <Canvas
      dpr={dpr}
      frameloop={active ? "always" : "never"}
      camera={{ position: [0, 0, 4.7], fov: 50, near: 0.1, far: 200 }}
      gl={{
        antialias: false,
        powerPreference: "high-performance",
        alpha: false,
        stencil: false,
      }}
      onCreated={({ gl }) => {
        gl.setClearColor("#05050a");
        onReady();
      }}
    >
      <color attach="background" args={["#05050a"]} />
      <fog attach="fog" args={["#05050a", 14, 34]} />
      <PerformanceMonitor
        onDecline={() => {
          setDpr(1);
          setTier(0);
        }}
        onIncline={() => setDpr(Math.min(1.75, window.devicePixelRatio || 1))}
      />
      <World
        cards={cards}
        textures={textures}
        onSelect={onSelect}
        onPoke={() => {
          stage.jumpAt = performance.now();
          onPoke();
        }}
      />
      <Effects tier={tier} />
    </Canvas>
  );
}
