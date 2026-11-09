'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Coffee, Moon, Pause, Play, RotateCcw, Sun, SunMoon } from 'lucide-react';
import type { ActionRow, AgentRow, Overview } from './shared';
import { lookOf, POSE } from './shared';

/**
 * The Vita office in 3D: four wings, one desk per agent. Everything shown comes from the agents' real state
 * (the same as the floor plan): Vita's pose, the status lamp, the monitor, and envelopes flying between desks for
 * hand-offs. Drag to turn, scroll to zoom, click a desk to pick that agent.
 */

const WING_COLOR: Record<AgentRow['wing'], number> = { command: 0x01a0ec, leads: 0x38f6a9, studio: 0xb48cff, growth: 0xf5b544 };
const WING_RECT: Record<AgentRow['wing'], { x: number; z: number }> = {
  command: { x: -6.2, z: -5.2 }, leads: { x: 6.2, z: -5.2 }, studio: { x: -6.2, z: 5.2 }, growth: { x: 6.2, z: 5.2 },
};
const WING_SIZE = { w: 11.2, d: 9 };
const TONE: Record<string, number> = { live: 0x38f6a9, shadow: 0x5cc8ff, wait: 0xf5b544, off: 0x8090ad };

/** A spot in the break room: what Vita does there, and the pose for it. */
type Fun = 'tt' | 'watch' | 'dance' | 'sofa' | 'chat' | 'bag';
interface Slot { kind: Fun; x: number; z: number; h: number; pose: keyof typeof POSE; face: 1 | -1; who: string | null }
const LOUNGE = { x: 0, z: -15.6, w: 17, d: 6.6 };
const TT = { x: -4.6, z: -15.4 };
const SAYINGS: Record<Fun, string[]> = {
  tt: ['ping!', 'pong!', 'smash!', 'got it!'],
  watch: ['nice shot!', 'go go go!', 'ooh!', 'wow!'],
  dance: ['♪ ♫', 'woohoo!', '♫♪♫', 'party!'],
  sofa: ['haha!', 'hehe', 'lol', 'chai?', 'samosa?'],
  chat: ['haha!', 'no way!', 'hey!', 'so funny'],
  bag: ['ahh…', 'chill', 'nice…'],
};

interface Desk {
  id: string;
  name: string;
  group: THREE.Group;
  hit: THREE.Mesh;
  /** Vita herself: walks between the desk and the break room. */
  body: THREE.Group;
  pet: THREE.Sprite;
  tag: THREE.Sprite;
  bubble: THREE.Sprite;
  bubbleUntil: number;
  nextBubble: number;
  seat: THREE.Vector3;
  slot: Slot | null;
  deskBase: boolean;
  workUntil: number;
  where: 'desk' | 'break' | 'walking';
  lookImg: string;
  lookLabel: string;
  lookTone: string;
  sleepy: boolean;
  selected: boolean;
  lamp: THREE.Mesh;
  halo: THREE.Sprite;
  screen: THREE.Mesh;
  screenTex: THREE.CanvasTexture;
  screenCtx: CanvasRenderingContext2D;
  label: THREE.Sprite;
  labelKey: string;
  zz: THREE.Sprite[];
  ring: THREE.Mesh;
  anim: string;
  tone: string;
  busy: boolean;
  mail: THREE.Sprite;
  mailUntil: number;
  phase: number;
}

function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d')!;
  draw(c);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

function labelTexture(name: string, state: string, color: string, selected: boolean) {
  return canvasTexture(512, 150, (c) => {
    roundRect(c, 6, 6, 500, 138, 34);
    c.fillStyle = selected ? 'rgba(14,40,34,0.95)' : 'rgba(11,18,32,0.88)'; c.fill();
    c.lineWidth = selected ? 6 : 3; c.strokeStyle = selected ? '#38f6a9' : 'rgba(127,160,210,0.45)'; c.stroke();
    c.fillStyle = '#ffffff'; c.font = '700 46px Inter, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(name, 256, 56, 470);
    c.fillStyle = color; c.font = '700 34px Inter, system-ui, sans-serif';
    c.fillText(state, 256, 108, 470);
  });
}

function textSprite(text: string, size: number, color: string) {
  const t = canvasTexture(128, 128, (c) => { c.fillStyle = color; c.font = `800 ${size}px Inter, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 64, 64); });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  return s;
}

function bubbleTexture(text: string) {
  return canvasTexture(256, 128, (c) => {
    roundRect(c, 8, 8, 240, 86, 30); c.fillStyle = '#ffffff'; c.fill();
    c.beginPath(); c.moveTo(70, 90); c.lineTo(60, 120); c.lineTo(100, 92); c.closePath(); c.fill();
    c.lineWidth = 4; c.strokeStyle = '#1b2a4a'; roundRect(c, 8, 8, 240, 86, 30); c.stroke();
    c.fillStyle = '#1b2a4a'; c.font = '800 40px Inter, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, 128, 52, 220);
  });
}

function tagTexture(name: string) {
  return canvasTexture(320, 72, (c) => {
    roundRect(c, 4, 4, 312, 64, 30); c.fillStyle = 'rgba(11,18,32,0.82)'; c.fill();
    c.fillStyle = '#ffffff'; c.font = '700 34px Inter, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(name, 160, 38, 296);
  });
}

function haloTexture() {
  return canvasTexture(128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.35, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  });
}

function mailTexture() {
  return canvasTexture(128, 128, (c) => {
    roundRect(c, 14, 26, 100, 76, 14); c.fillStyle = '#01a0ec'; c.fill();
    c.strokeStyle = '#0b1220'; c.lineWidth = 8; c.beginPath(); c.moveTo(22, 36); c.lineTo(64, 70); c.lineTo(106, 36); c.stroke();
  });
}

/** Day is 6 am to 6 pm in India (the hospital's time), whatever the viewer's own clock says. */
export function isDayInIndia(now = new Date()): boolean {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(now));
  return h >= 6 && h < 18;
}
type SkyMode = 'auto' | 'day' | 'night';
const SKY_KEY = 'vita.office.sky';

/** The floor: soft grid lines that fade out at the edges, so the office floats on the sky. */
function floorTexture() {
  return canvasTexture(1024, 1024, (c) => {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, 1024, 1024);
    c.strokeStyle = 'rgba(120,140,170,0.35)'; c.lineWidth = 2;
    for (let i = 0; i <= 1024; i += 1024 / 48) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 1024); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(1024, i); c.stroke(); }
    c.globalCompositeOperation = 'destination-in';
    const g = c.createRadialGradient(512, 512, 250, 512, 512, 512);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, 1024, 1024);
  });
}

/** Positions of the desks inside a wing: up to three in a row, centred. */
function deskSpots(n: number): { x: number; z: number }[] {
  const cols = Math.min(3, n), rows = Math.ceil(n / 3);
  const sx = 3.4, sz = 3.9;
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / 3), inRow = r === rows - 1 ? n - r * 3 : cols, c = i % 3;
    out.push({ x: (c - (inRow - 1) / 2) * sx, z: (r - (rows - 1) / 2) * sz + 0.4 });
  }
  return out;
}

export function webglOk(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

export function Office3D({ data, selected, onPick, handoff, onFail }: {
  data: Overview; selected: string; onPick: (id: string) => void; handoff: ActionRow | null; onFail: () => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const api = useRef<{ update: (d: Overview, sel: string) => void; fly: (from: string, to: string) => void; reset: () => void; lounge: () => void; setSpin: (on: boolean) => void; setSky: (day: boolean) => void } | null>(null);
  const pickRef = useRef(onPick);
  const failRef = useRef(onFail);
  const [spin, setSpin] = useState(true);
  const [skyMode, setSkyMode] = useState<SkyMode>(() => {
    try { const v = localStorage.getItem(SKY_KEY); return v === 'day' || v === 'night' ? v : 'auto'; } catch { return 'auto'; }
  });
  const [clockDay, setClockDay] = useState(() => isDayInIndia());
  const day = skyMode === 'auto' ? clockDay : skyMode === 'day';
  const lastHandoff = useRef<string | null>(null);

  useEffect(() => { pickRef.current = onPick; failRef.current = onFail; }, [onPick, onFail]);

  // Build the scene once.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
      renderer.setClearColor(0x000000, 0);
    } catch { failRef.current(); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', 'Vita office in 3D. Drag to turn, scroll to zoom, click a desk to pick an agent.');
    renderer.domElement.setAttribute('role', 'img');

    const scene = new THREE.Scene();
    // No 3D background: the sky (sun or moon) is drawn behind the canvas.

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    const HOME_TARGET = new THREE.Vector3(0, 0, -4);
    const home = new THREE.Vector3(14, 17.5, 14.5);
    camera.position.copy(home);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 7;
    controls.maxDistance = 55;
    controls.maxPolarAngle = 1.22;
    controls.target.copy(HOME_TARGET);
    controls.autoRotate = !reduce;
    controls.autoRotateSpeed = 0.45;
    let spinWanted = !reduce;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    controls.addEventListener('start', () => { controls.autoRotate = false; if (idleTimer) clearTimeout(idleTimer); });
    controls.addEventListener('end', () => { if (idleTimer) clearTimeout(idleTimer); idleTimer = setTimeout(() => { controls.autoRotate = spinWanted; }, 9000); });

    // Light: soft sky + the sun (or the moon) casting shadows.
    const hemi = new THREE.HemisphereLight(0xcfe2ff, 0x24305a, 1.5);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(14, 26, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 70 });
    sun.shadow.bias = -0.0006;
    scene.add(sun);
    const fill = new THREE.AmbientLight(0x6f8fd0, 0.25);
    scene.add(fill);

    const disposables: { dispose: () => void }[] = [];
    const keep = <T extends { dispose: () => void }>(x: T) => { disposables.push(x); return x; };

    // Floor with a fading grid.
    const floorMat = keep(new THREE.MeshStandardMaterial({ color: 0xeef3fa, roughness: 0.95, map: keep(floorTexture()), transparent: true, depthWrite: false }));
    const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(72, 72)), floorMat);
    floor.position.z = -4; floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    scene.add(floor);
    // Lamps over the wings that come on at night.
    const nightLamps: THREE.PointLight[] = [];
    for (const w of Object.values(WING_RECT)) {
      const pl = new THREE.PointLight(0xffd9a0, 0, 14, 1.6); pl.position.set(w.x, 4.2, w.z); scene.add(pl); nightLamps.push(pl);
    }

    // Shared geometry and materials for the furniture.
    const G = {
      top: keep(new THREE.BoxGeometry(1.9, 0.08, 0.9)), leg: keep(new THREE.BoxGeometry(0.07, 0.72, 0.07)),
      mon: keep(new THREE.BoxGeometry(0.86, 0.52, 0.05)), stand: keep(new THREE.BoxGeometry(0.08, 0.28, 0.08)), base: keep(new THREE.BoxGeometry(0.34, 0.03, 0.2)),
      screen: keep(new THREE.PlaneGeometry(0.78, 0.44)), seat: keep(new THREE.BoxGeometry(0.62, 0.08, 0.58)), back: keep(new THREE.BoxGeometry(0.62, 0.62, 0.07)),
      pole: keep(new THREE.CylinderGeometry(0.04, 0.04, 0.42, 10)), panelBack: keep(new THREE.BoxGeometry(2.6, 1.3, 0.06)), panelSide: keep(new THREE.BoxGeometry(0.06, 1.3, 1.9)),
      lamp: keep(new THREE.SphereGeometry(0.13, 20, 16)), hit: keep(new THREE.BoxGeometry(2.8, 2.8, 2.6)), ring: keep(new THREE.RingGeometry(1.45, 1.6, 48)),
      mug: keep(new THREE.CylinderGeometry(0.07, 0.06, 0.13, 12)), plantPot: keep(new THREE.CylinderGeometry(0.16, 0.12, 0.26, 14)), plant: keep(new THREE.SphereGeometry(0.3, 14, 12)),
    };
    const M = {
      desk: keep(new THREE.MeshStandardMaterial({ color: 0x3b4f7a, roughness: 0.6 })), leg: keep(new THREE.MeshStandardMaterial({ color: 0x26365a, roughness: 0.5, metalness: 0.4 })),
      mon: keep(new THREE.MeshStandardMaterial({ color: 0x0e1525, roughness: 0.4, metalness: 0.3 })), chair: keep(new THREE.MeshStandardMaterial({ color: 0x1f2b48, roughness: 0.8 })),
      panel: keep(new THREE.MeshPhysicalMaterial({ color: 0x9fc4ff, transparent: true, opacity: 0.16, roughness: 0.1, metalness: 0, side: THREE.DoubleSide })),
      mug: keep(new THREE.MeshStandardMaterial({ color: 0xe8eefc, roughness: 0.4 })), pot: keep(new THREE.MeshStandardMaterial({ color: 0x6d4c41, roughness: 0.9 })),
      leaf: keep(new THREE.MeshStandardMaterial({ color: 0x1a7a5a, roughness: 0.8 })), hit: keep(new THREE.MeshBasicMaterial({ visible: false })),
    };
    const loader = new THREE.TextureLoader();
    const tex: Record<string, THREE.Texture> = {};
    const poseTex = (url: string) => {
      if (!tex[url]) { tex[url] = loader.load(url); tex[url].colorSpace = THREE.SRGBColorSpace; keep(tex[url]); }
      return tex[url];
    };
    const halo = keep(haloTexture());
    const mail = keep(mailTexture());

    // Wings: a coloured rug and its name on the floor.
    const wings = new Map<AgentRow['wing'], AgentRow[]>();
    for (const a of data.agents) wings.set(a.wing, [...(wings.get(a.wing) ?? []), a]);
    const desks = new Map<string, Desk>();
    for (const [wing, agents] of wings) {
      const at = WING_RECT[wing];
      const rug = new THREE.Mesh(keep(new THREE.PlaneGeometry(WING_SIZE.w, WING_SIZE.d)),
        keep(new THREE.MeshStandardMaterial({ color: WING_COLOR[wing], transparent: true, opacity: 0.13, roughness: 1 })));
      rug.rotation.x = -Math.PI / 2; rug.position.set(at.x, 0.01, at.z); rug.receiveShadow = true;
      scene.add(rug);
      const edge = new THREE.LineSegments(keep(new THREE.EdgesGeometry(new THREE.PlaneGeometry(WING_SIZE.w, WING_SIZE.d))),
        keep(new THREE.LineBasicMaterial({ color: WING_COLOR[wing], transparent: true, opacity: 0.55 })));
      edge.rotation.x = -Math.PI / 2; edge.position.set(at.x, 0.02, at.z);
      scene.add(edge);
      const name = agents[0]?.wingName ?? wing;
      const sign = new THREE.Mesh(keep(new THREE.PlaneGeometry(5, 0.9)), keep(new THREE.MeshBasicMaterial({
        map: keep(canvasTexture(640, 116, (c) => { c.fillStyle = '#' + WING_COLOR[wing].toString(16).padStart(6, '0'); c.font = '800 64px Inter, sans-serif'; c.textBaseline = 'middle'; c.fillText(name.toUpperCase(), 8, 60, 624); })),
        transparent: true, depthWrite: false,
      })));
      sign.rotation.x = -Math.PI / 2; sign.position.set(at.x - WING_SIZE.w / 2 + 2.7, 0.03, at.z - WING_SIZE.d / 2 + 0.6);
      scene.add(sign);

      const spots = deskSpots(agents.length);
      agents.forEach((a, i) => {
        const g = new THREE.Group();
        g.position.set(at.x + spots[i].x, 0, at.z + spots[i].z);
        // Desk
        const top = new THREE.Mesh(G.top, M.desk); top.position.set(0, 0.76, 0); top.castShadow = true; top.receiveShadow = true; g.add(top);
        for (const [lx, lz] of [[-0.88, -0.38], [0.88, -0.38], [-0.88, 0.38], [0.88, 0.38]]) {
          const leg = new THREE.Mesh(G.leg, M.leg); leg.position.set(lx, 0.36, lz); leg.castShadow = true; g.add(leg);
        }
        // Monitor with a live screen
        const mon = new THREE.Mesh(G.mon, M.mon); mon.position.set(0.25, 1.22, -0.28); mon.castShadow = true; g.add(mon);
        const stand = new THREE.Mesh(G.stand, M.leg); stand.position.set(0.25, 0.94, -0.28); g.add(stand);
        const base = new THREE.Mesh(G.base, M.leg); base.position.set(0.25, 0.81, -0.28); g.add(base);
        const cv = document.createElement('canvas'); cv.width = 256; cv.height = 144;
        const sctx = cv.getContext('2d')!;
        const stex = keep(new THREE.CanvasTexture(cv)); stex.colorSpace = THREE.SRGBColorSpace;
        const screen = new THREE.Mesh(G.screen, keep(new THREE.MeshBasicMaterial({ map: stex, toneMapped: false })));
        screen.position.set(0.25, 1.22, -0.25); g.add(screen);
        // Mug and a plant
        const mug = new THREE.Mesh(G.mug, M.mug); mug.position.set(-0.55, 0.86, 0.12); mug.castShadow = true; g.add(mug);
        if (i % 2 === 0) {
          const pot = new THREE.Mesh(G.plantPot, M.pot); pot.position.set(-1.05, 0.13, -0.75); pot.castShadow = true; g.add(pot);
          const leaf = new THREE.Mesh(G.plant, M.leaf); leaf.position.set(-1.05, 0.48, -0.75); leaf.castShadow = true; g.add(leaf);
        }
        // Chair
        const pole = new THREE.Mesh(G.pole, M.leg); pole.position.set(0, 0.21, 0.75); g.add(pole);
        const chairSeat = new THREE.Mesh(G.seat, M.chair); chairSeat.position.set(0, 0.46, 0.75); chairSeat.castShadow = true; g.add(chairSeat);
        const back = new THREE.Mesh(G.back, M.chair); back.position.set(0, 0.8, 1.04); back.castShadow = true; g.add(back);
        // Glass partitions
        const pb = new THREE.Mesh(G.panelBack, M.panel); pb.position.set(0, 0.65, -0.95); g.add(pb);
        const pl = new THREE.Mesh(G.panelSide, M.panel); pl.position.set(-1.3, 0.65, 0); g.add(pl);
        const pr = new THREE.Mesh(G.panelSide, M.panel); pr.position.set(1.3, 0.65, 0); g.add(pr);
        // Vita: her own body, so she can walk off to the break room and back.
        const body = new THREE.Group();
        const seat = new THREE.Vector3(g.position.x, 0, g.position.z + 0.72);
        body.position.copy(seat);
        const pet = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: poseTex(POSE.sleep), transparent: true, depthWrite: true, alphaTest: 0.15 })));
        pet.scale.set(1.4, 1.4, 1); pet.position.set(0, 1.1, 0); pet.userData.agent = a.id; body.add(pet);
        const tag = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: keep(tagTexture(a.name)), transparent: true, depthWrite: false, depthTest: false })));
        tag.scale.set(1.7, 0.38, 1); tag.position.set(0, 2.05, 0); tag.renderOrder = 9; tag.visible = false; body.add(tag);
        const bubble = new THREE.Sprite(keep(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false })));
        bubble.scale.set(1.3, 0.65, 1); bubble.position.set(0.55, 2.55, 0); bubble.renderOrder = 11; bubble.visible = false; body.add(bubble);
        scene.add(body);
        // Status lamp with a glow
        const lampMat = keep(new THREE.MeshStandardMaterial({ color: 0x8090ad, emissive: 0x8090ad, emissiveIntensity: 1.2 }));
        const lamp = new THREE.Mesh(G.lamp, lampMat); lamp.position.set(1.15, 1.42, -0.95); g.add(lamp);
        const hl = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: halo, color: 0x8090ad, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
        hl.scale.set(1, 1, 1); hl.position.copy(lamp.position); g.add(hl);
        // Name tag
        const label = new THREE.Sprite(keep(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false })));
        label.scale.set(3.3, 0.97, 1); label.position.set(0, 2.75, 0); label.renderOrder = 10; g.add(label);
        // Zz for sleeping
        const zz = [textSprite('z', 72, '#9aa8c4'), textSprite('Z', 90, '#9aa8c4')];
        zz.forEach((z) => { z.scale.set(0.45, 0.45, 1); z.visible = false; body.add(z); keep(z.material.map!); keep(z.material); });
        // Incoming mail
        const mailS = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: mail, transparent: true, depthWrite: false })));
        mailS.scale.set(0.6, 0.6, 1); mailS.position.set(-0.7, 1.9, 0); mailS.visible = false; g.add(mailS);
        // Selection ring and the click target
        const ring = new THREE.Mesh(G.ring, keep(new THREE.MeshBasicMaterial({ color: 0x38f6a9, transparent: true, opacity: 0.85, side: THREE.DoubleSide })));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; ring.visible = false; g.add(ring);
        const hit = new THREE.Mesh(G.hit, M.hit); hit.position.y = 1.3; hit.userData.agent = a.id; g.add(hit);
        scene.add(g);
        desks.set(a.id, {
          id: a.id, name: a.name, group: g, hit, body, pet, tag, bubble, bubbleUntil: 0, nextBubble: 3000 + Math.random() * 6000, seat, slot: null,
          deskBase: true, workUntil: 0, where: 'desk', lookImg: POSE.sleep, lookLabel: '', lookTone: 'off', sleepy: false, selected: false, lamp, halo: hl, screen, screenTex: stex, screenCtx: sctx, label, labelKey: '', zz, ring,
          anim: 'none', tone: 'off', busy: false, mail: mailS, mailUntil: 0, phase: Math.random() * Math.PI * 2,
        });
      });
    }

    // The break room: table tennis, a sofa, bean bags and music.
    const lounge = new THREE.Group();
    {
      const rug = new THREE.Mesh(keep(new THREE.PlaneGeometry(LOUNGE.w, LOUNGE.d)), keep(new THREE.MeshStandardMaterial({ color: 0xff8a65, transparent: true, opacity: 0.16, roughness: 1 })));
      rug.rotation.x = -Math.PI / 2; rug.position.set(LOUNGE.x, 0.01, LOUNGE.z); rug.receiveShadow = true; lounge.add(rug);
      const edge = new THREE.LineSegments(keep(new THREE.EdgesGeometry(new THREE.PlaneGeometry(LOUNGE.w, LOUNGE.d))), keep(new THREE.LineBasicMaterial({ color: 0xff8a65, transparent: true, opacity: 0.6 })));
      edge.rotation.x = -Math.PI / 2; edge.position.set(LOUNGE.x, 0.02, LOUNGE.z); lounge.add(edge);
      const sign = new THREE.Mesh(keep(new THREE.PlaneGeometry(5, 0.9)), keep(new THREE.MeshBasicMaterial({
        map: keep(canvasTexture(640, 116, (c) => { c.fillStyle = '#ff8a65'; c.font = '800 64px Inter, sans-serif'; c.textBaseline = 'middle'; c.fillText('BREAK ROOM', 8, 60, 624); })), transparent: true, depthWrite: false,
      })));
      sign.rotation.x = -Math.PI / 2; sign.position.set(LOUNGE.x - LOUNGE.w / 2 + 2.7, 0.03, LOUNGE.z - LOUNGE.d / 2 + 0.6); lounge.add(sign);
      const mat = (color: number, rough = 0.7) => keep(new THREE.MeshStandardMaterial({ color, roughness: rough }));
      const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
        const b = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, d)), m); b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true; lounge.add(b); return b;
      };
      // Table tennis
      box(2.6, 0.06, 1.4, mat(0x1f7a4d, 0.5), TT.x, 0.76, TT.z);
      box(2.6, 0.065, 0.03, mat(0xffffff), TT.x, 0.765, TT.z);
      box(0.03, 0.18, 1.52, keep(new THREE.MeshStandardMaterial({ color: 0xf2f5fb, transparent: true, opacity: 0.85 })), TT.x, 0.88, TT.z);
      for (const [lx, lz] of [[-1.15, -0.6], [1.15, -0.6], [-1.15, 0.6], [1.15, 0.6]]) box(0.07, 0.73, 0.07, M.leg, TT.x + lx, 0.365, TT.z + lz);
      // Sofa, coffee table and snacks
      const sofaM = mat(0x7c5cff, 0.85);
      box(3.3, 0.45, 0.95, sofaM, 3, 0.25, -17.3); box(3.3, 0.7, 0.25, sofaM, 3, 0.75, -17.75);
      box(0.25, 0.65, 0.95, sofaM, 1.3, 0.35, -17.3); box(0.25, 0.65, 0.95, sofaM, 4.7, 0.35, -17.3);
      box(1.6, 0.06, 0.8, mat(0xc9a27a, 0.6), 3, 0.42, -16.05);
      for (const [lx, lz] of [[-0.7, -0.32], [0.7, -0.32], [-0.7, 0.32], [0.7, 0.32]]) box(0.06, 0.4, 0.06, M.leg, 3 + lx, 0.2, -16.05 + lz);
      const m1 = new THREE.Mesh(G.mug, M.mug); m1.position.set(2.7, 0.52, -16.0); lounge.add(m1);
      const m2 = new THREE.Mesh(G.mug, mat(0xffb74d)); m2.position.set(3.25, 0.52, -16.15); lounge.add(m2);
      const bowl = new THREE.Mesh(keep(new THREE.SphereGeometry(0.18, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)), mat(0xe57373)); bowl.position.set(3.0, 0.62, -15.9); lounge.add(bowl);
      // Bean bags
      for (const [bx, bz, col] of [[7.0, -14.2, 0xffa726], [7.4, -15.8, 0x26c6da], [6.7, -17.4, 0xef5350]] as const) {
        const bag = new THREE.Mesh(keep(new THREE.SphereGeometry(0.55, 20, 14)), mat(col, 0.95)); bag.scale.set(1, 0.6, 1); bag.position.set(bx, 0.3, bz); bag.castShadow = true; lounge.add(bag);
      }
      // Music speaker and a little dance floor
      box(0.7, 1.5, 0.6, mat(0x1b2238, 0.4), -0.9, 0.75, -18.0);
      for (const [y, r] of [[1.15, 0.2], [0.55, 0.26]] as const) {
        const cone = new THREE.Mesh(keep(new THREE.CircleGeometry(r, 24)), mat(0x5a6b95, 0.3)); cone.position.set(-0.9, y, -17.69); lounge.add(cone);
      }
      const dance = new THREE.Mesh(keep(new THREE.CircleGeometry(1.5, 40)), keep(new THREE.MeshBasicMaterial({ color: 0xb48cff, transparent: true, opacity: 0.25 })));
      dance.rotation.x = -Math.PI / 2; dance.position.set(-0.3, 0.025, -15.4); lounge.add(dance);
      // Plants at the corners
      for (const [px, pz] of [[-8, -12.6], [8, -18.6]] as const) {
        const pot = new THREE.Mesh(G.plantPot, M.pot); pot.position.set(px, 0.13, pz); lounge.add(pot);
        const leaf = new THREE.Mesh(G.plant, M.leaf); leaf.scale.setScalar(1.4); leaf.position.set(px, 0.6, pz); leaf.castShadow = true; lounge.add(leaf);
      }
      scene.add(lounge);
    }
    const ball = new THREE.Mesh(keep(new THREE.SphereGeometry(0.07, 14, 10)), keep(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffa040, emissiveIntensity: 0.3 })));
    ball.castShadow = true; ball.visible = false; scene.add(ball);
    const notes = [textSprite('♪', 96, '#b48cff'), textSprite('♫', 96, '#ff8a65'), textSprite('♪', 96, '#38f6a9')];
    notes.forEach((n) => { n.scale.set(0.5, 0.5, 1); n.visible = false; scene.add(n); keep(n.material.map!); keep(n.material); });

    // Spots in the order they fill: the game first, then the music and the sofa.
    const slots: Slot[] = [
      { kind: 'tt', x: TT.x - 1.75, z: TT.z, h: 0.75, pose: 'cheer', face: 1, who: null },
      { kind: 'tt', x: TT.x + 1.75, z: TT.z, h: 0.75, pose: 'wave', face: -1, who: null },
      { kind: 'dance', x: -0.9, z: -15.0, h: 0.75, pose: 'fly', face: 1, who: null },
      { kind: 'sofa', x: 2.1, z: -17.1, h: 0.95, pose: 'snack', face: 1, who: null },
      { kind: 'sofa', x: 3.9, z: -17.1, h: 0.95, pose: 'coffee', face: -1, who: null },
      { kind: 'watch', x: TT.x - 0.6, z: TT.z - 1.6, h: 0.75, pose: 'cheer', face: 1, who: null },
      { kind: 'dance', x: 0.4, z: -15.8, h: 0.75, pose: 'cheer', face: -1, who: null },
      { kind: 'chat', x: 4.9, z: -15.3, h: 0.75, pose: 'wave', face: -1, who: null },
      { kind: 'bag', x: 7.0, z: -14.0, h: 0.95, pose: 'relax', face: -1, who: null },
      { kind: 'sofa', x: 3.0, z: -17.1, h: 0.95, pose: 'relax', face: 1, who: null },
      { kind: 'dance', x: -0.2, z: -14.5, h: 0.75, pose: 'wave', face: 1, who: null },
      { kind: 'watch', x: TT.x + 0.6, z: TT.z - 1.6, h: 0.75, pose: 'wave', face: -1, who: null },
      { kind: 'bag', x: 7.4, z: -15.6, h: 0.95, pose: 'coffee', face: -1, who: null },
      { kind: 'bag', x: 6.7, z: -17.2, h: 0.95, pose: 'snack', face: -1, who: null },
    ];
    const bubbleTex: Record<string, THREE.CanvasTexture> = {};
    const bubbleOf = (text: string) => (bubbleTex[text] ??= keep(bubbleTexture(text)));

    /** Who sits where: agents keep their spot while they stay on break; the table-tennis table never stands empty. */
    const seatAll = () => {
      for (const sl of slots) {
        const k = sl.who ? desks.get(sl.who) : null;
        if (!k || k.deskBase) sl.who = null;
      }
      for (const k of desks.values()) if (k.slot && k.slot.who !== k.id) k.slot = null;
      const waiting = [...desks.values()].filter((k) => !k.deskBase && !k.slot);
      for (const k of waiting) {
        const free = slots.find((x) => !x.who);
        if (!free) break;
        free.who = k.id; k.slot = free;
      }
      for (const t of slots.filter((x) => x.kind === 'tt' && !x.who)) {
        const from = slots.find((x) => x.who && x.kind !== 'tt' && x.kind === 'watch') ?? [...slots].reverse().find((x) => x.who && x.kind !== 'tt');
        if (!from) break;
        const k = desks.get(from.who!)!;
        from.who = null; t.who = k.id; k.slot = t;
      }
    };

    // Hand-off envelopes flying between desks.
    const flights: { mesh: THREE.Sprite; from: THREE.Vector3; to: THREE.Vector3; t0: number; dur: number; target: string }[] = [];
    const fly = (from: string, to: string) => {
      const a = desks.get(from), b = desks.get(to);
      if (!a || !b) return;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: mail, transparent: true, depthWrite: false }));
      s.scale.set(0.7, 0.7, 1);
      scene.add(s);
      flights.push({ mesh: s, from: a.group.position.clone().setY(2), to: b.group.position.clone().setY(2), t0: performance.now(), dur: reduce ? 1 : 2600, target: to });
    };

    // Applying the agents' state to the desks.
    let stopAll = false;
    let placed = false;
    let day = true;
    const light = () => {
      const dim = stopAll ? 0.5 : 1;
      if (day) {
        hemi.color.set(stopAll ? 0xffd0d0 : 0xffffff); hemi.groundColor.set(0xb9c6dc); hemi.intensity = 1.7 * dim;
        sun.color.set(0xfff0d2); sun.intensity = 2.4 * dim; sun.position.set(-10, 28, -14);
        fill.color.set(0xffffff); fill.intensity = 0.35;
        floorMat.color.set(0xeef3fa);
        nightLamps.forEach((l) => { l.intensity = 0; });
      } else {
        hemi.color.set(stopAll ? 0xd09090 : 0x9fb6ff); hemi.groundColor.set(0x0b1430); hemi.intensity = 0.8 * dim;
        sun.color.set(0xc7d8ff); sun.intensity = 0.9 * dim; sun.position.set(-14, 24, -10);
        fill.color.set(0x4058a0); fill.intensity = 0.35;
        floorMat.color.set(0x24335a);
        nightLamps.forEach((l) => { l.intensity = stopAll ? 0 : 9; });
      }
    };
    const setSky = (isDay: boolean) => { day = isDay; light(); };
    const update = (d: Overview, sel: string) => {
      stopAll = d.stopAll.on;
      light();
      for (const a of d.agents) {
        const k = desks.get(a.id);
        if (!k) continue;
        const l = lookOf(a, d.stopAll.on);
        const recent = !!a.last && Date.now() - new Date(a.last.created_at).getTime() < 5 * 60e3;
        // At the desk: the Guard (always on duty), anyone working right now, and anyone switched off or paused (asleep at the desk).
        // Everyone else has no work at the moment and goes to the break room.
        k.deskBase = a.id === 'compliance_guard' || recent || a.paused || (a.available && a.mode === 'off');
        k.lookImg = l.img; k.lookLabel = l.label; k.lookTone = l.tone; k.sleepy = l.zz;
        k.anim = reduce ? 'none' : l.anim;
        k.tone = l.tone;
        k.busy = l.anim === 'bob' || l.anim === 'guard' || l.anim === 'tilt';
        const col = TONE[l.tone] ?? TONE.off;
        const lm = k.lamp.material as THREE.MeshStandardMaterial;
        lm.color.setHex(col); lm.emissive.setHex(col);
        (k.halo.material as THREE.SpriteMaterial).color.setHex(col);
        k.zz.forEach((z) => { z.visible = l.zz && !reduce; });
        k.ring.visible = a.id === sel;
        k.selected = a.id === sel;
        relabel(k);
      }
      seatAll();
      // First time: everyone starts where they belong, no parade across the office.
      if (!placed) {
        placed = true;
        for (const k of desks.values()) {
          if (!k.deskBase && k.slot) { k.body.position.set(k.slot.x, 0, k.slot.z); k.where = 'break'; relabel(k); }
        }
      }
    };
    function relabel(k: Desk) {
      const state = k.where === 'break' ? `${k.lookLabel} · on a break` : k.where === 'walking' ? (wantsDesk(k, performance.now()) ? 'On the way to work' : 'Off for a break') : k.lookLabel;
      const col = TONE[k.lookTone] ?? TONE.off;
      const key = `${k.name}|${state}|${k.selected}`;
      if (key === k.labelKey) return;
      k.labelKey = key;
      const old = (k.label.material as THREE.SpriteMaterial).map;
      (k.label.material as THREE.SpriteMaterial).map = labelTexture(k.name, state, '#' + col.toString(16).padStart(6, '0'), k.selected);
      (k.label.material as THREE.SpriteMaterial).needsUpdate = true;
      old?.dispose();
    }
    const wantsDesk = (k: Desk, t: number) => !k.slot || (stopAll ? k.where !== 'break' : k.deskBase || t < k.workUntil);

    // Monitor content: scrolling lines while working, dim when asleep.
    const drawScreen = (k: Desk, t: number) => {
      const c = k.screenCtx;
      c.fillStyle = '#060c18'; c.fillRect(0, 0, 256, 144);
      if (k.tone === 'off' || stopAll || k.where !== 'desk') { c.fillStyle = '#121a2c'; c.fillRect(110, 64, 36, 16); k.screenTex.needsUpdate = true; return; }
      const col = '#' + (TONE[k.tone] ?? TONE.off).toString(16).padStart(6, '0');
      const speed = k.busy ? 22 : 5;
      for (let i = 0; i < 7; i++) {
        const y = ((i * 22 - (t / 1000) * speed) % 154 + 154) % 154 - 6;
        const w = 40 + ((i * 53 + k.phase * 37) % 150);
        c.globalAlpha = 0.85; c.fillStyle = i % 3 === 0 ? col : '#9fdcff';
        c.fillRect(14, y, w, 7);
      }
      c.globalAlpha = 1;
      if (k.busy && Math.floor(t / 500) % 2 === 0) { c.fillStyle = col; c.fillRect(14, 126, 12, 10); }
      k.screenTex.needsUpdate = true;
    };

    // Picking.
    const ray = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const hits: THREE.Object3D[] = [...desks.values()].flatMap((k) => [k.hit, k.pet]);
    const targetTo = HOME_TARGET.clone();
    let flyTarget = false;
    let camGoal: THREE.Vector3 | null = null;
    let downAt: { x: number; y: number } | null = null;
    const pick = (ev: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      return ray.intersectObjects(hits, false)[0]?.object.userData.agent as string | undefined;
    };
    const onDown = (ev: PointerEvent) => { downAt = { x: ev.clientX, y: ev.clientY }; };
    const onUp = (ev: PointerEvent) => {
      if (!downAt || Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 6) return;
      const id = pick(ev);
      if (id) {
        pickRef.current(id);
        { const k = desks.get(id)!; targetTo.copy(k.where === 'desk' ? k.group.position : k.body.position).setY(0); } flyTarget = true;
        controls.autoRotate = false;
      }
    };
    let hovered: string | undefined;
    const onMove = (ev: PointerEvent) => {
      const id = pick(ev);
      if (id !== hovered) {
        if (hovered) desks.get(hovered)?.group.position.setY(0);
        hovered = id;
        renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
      }
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointermove', onMove);

    // Size and visibility: draw only while on screen and the tab is visible.
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
      camera.aspect = w / Math.max(1, h);
      camera.fov = w < 640 ? 52 : 38;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    let visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(el);

    let raf = 0;
    let lastT = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (!visible || document.hidden) return;
      if (flyTarget) {
        controls.target.lerp(targetTo, 0.08);
        if (camGoal) camera.position.lerp(camGoal, 0.06);
        if (controls.target.distanceTo(targetTo) < 0.05 && (!camGoal || camera.position.distanceTo(camGoal) < 0.1)) { flyTarget = false; camGoal = null; }
      }
      controls.update();
      const dt = Math.min(0.25, (t - (lastT || t)) / 1000); lastT = t;
      // The table-tennis ball flies only while both players are at the table.
      const players = slots.filter((x) => x.kind === 'tt').map((x) => (x.who ? desks.get(x.who) : null));
      const rally = !reduce && !stopAll && players.every((k) => k && k.where === 'break');
      ball.visible = rally;
      let hitter = -1;
      if (rally) {
        const stroke = 900, n = Math.floor(t / stroke), f = (t % stroke) / stroke, dir = n % 2 === 0 ? 1 : -1;
        const x0 = TT.x - 1.45 * dir, x1 = TT.x + 1.45 * dir, xb = TT.x + 0.75 * dir;
        if (f < 0.7) { const u = f / 0.7; ball.position.set(x0 + (xb - x0) * u, 1.12 + (0.8 - 1.12) * u + Math.sin(u * Math.PI) * 0.45, TT.z + Math.sin(n * 1.7) * 0.25 * u); }
        else { const u = (f - 0.7) / 0.3; ball.position.set(xb + (x1 - xb) * u, 0.8 + (1.12 - 0.8) * u + Math.sin(u * Math.PI) * 0.25, TT.z + Math.sin(n * 1.7) * 0.25); }
        hitter = f > 0.85 ? (dir === 1 ? 1 : 0) : f < 0.12 ? (dir === 1 ? 0 : 1) : -1;
      }
      // Music notes rise from the speaker while someone is dancing.
      const dancing = !reduce && !stopAll && slots.some((x) => x.kind === 'dance' && x.who && desks.get(x.who)?.where === 'break');
      notes.forEach((nt, i) => {
        nt.visible = dancing;
        if (!dancing) return;
        const p = ((t / 2600) + i / 3) % 1;
        nt.position.set(-0.9 + Math.sin(p * 6 + i) * 0.5, 1.7 + p * 1.6, -17.8);
        (nt.material as THREE.SpriteMaterial).opacity = Math.sin(p * Math.PI);
      });
      for (const k of desks.values()) {
        const s = t / 1000 + k.phase;
        const mat = k.pet.material as THREE.SpriteMaterial;
        // Where to be: at the desk for work, in the break room otherwise.
        const toDesk = wantsDesk(k, t);
        const goal = toDesk ? k.seat : new THREE.Vector3(k.slot!.x, 0, k.slot!.z);
        const dx = goal.x - k.body.position.x, dz = goal.z - k.body.position.z, dist = Math.hypot(dx, dz);
        let face = 1, y = 1.1, rot = 0, sc = 1.4, img = k.lookImg;
        const before = k.where;
        if (dist > 0.04 && !(stopAll && k.where !== 'walking')) {
          if (reduce) { k.body.position.copy(goal); }
          else {
            const step = Math.min(dist, 3.4 * dt);
            k.body.position.x += (dx / dist) * step; k.body.position.z += (dz / dist) * step;
          }
          k.where = reduce ? (toDesk ? 'desk' : 'break') : 'walking';
          face = dx < 0 ? -1 : 1;
          y = 0.74 + Math.abs(Math.sin(s * 9)) * 0.14; rot = Math.sin(s * 9) * 0.07;
          img = toDesk ? POSE.work : POSE.wave;
          if (stopAll) img = POSE.sleep;
        } else {
          k.body.position.x = goal.x; k.body.position.z = goal.z;
          k.where = toDesk ? 'desk' : 'break';
          if (k.where === 'desk') {
            const called = t < k.workUntil && !k.deskBase;
            img = called ? POSE.work : k.lookImg;
            const anim = reduce ? 'none' : called ? 'bob' : k.anim;
            if (anim === 'bob') y += Math.sin(s * 2.9) * 0.08;
            else if (anim === 'tilt') rot = Math.sin(s * 2.1) * 0.08;
            else if (anim === 'breathe') sc = 1.4 * (1 + Math.sin(s * 1.6) * 0.025);
            k.pet.position.x = anim === 'guard' && Math.sin(s * 5) > 0.92 ? 0.06 * Math.sign(Math.sin(s * 37)) : 0;
          } else {
            const sl = k.slot!;
            y = sl.h; face = sl.face; img = stopAll ? POSE.sleep : POSE[sl.pose];
            if (!reduce && !stopAll) {
              if (sl.kind === 'tt') {
                const me = players.indexOf(k);
                y += hitter === me ? 0.18 : Math.abs(Math.sin(s * 3)) * 0.04; rot = hitter === me ? -0.15 * sl.face : 0;
              } else if (sl.kind === 'watch') { const j = Math.max(0, Math.sin(s * 2.2)); y += j * j * 0.35; }
              else if (sl.kind === 'dance') { y += Math.abs(Math.sin(s * 6.5)) * 0.2; rot = Math.sin(s * 3.2) * 0.18; face = Math.sin(s * 1.6) > 0 ? 1 : -1; }
              else if (sl.kind === 'chat') rot = Math.sin(s * 2.4) * 0.08;
              else sc = 1.4 * (1 + Math.sin(s * 1.5) * 0.03);
            }
          }
        }
        if (k.where !== before) relabel(k);
        mat.map = poseTex(img);
        k.pet.position.y = y; k.pet.scale.set(sc * face, sc, 1);
        mat.rotation = rot;
        k.tag.visible = k.where !== 'desk';
        // Desk name boards fade out when the camera comes close, so they never cover the view.
        const near = camera.position.distanceTo(k.group.position);
        (k.label.material as THREE.SpriteMaterial).opacity = Math.min(1, Math.max(0, (near - 11) / 5));
        k.label.visible = near > 11;
        // Chatter in the break room.
        if (k.where === 'break' && !stopAll && !reduce && t > k.nextBubble) {
          const say = SAYINGS[k.slot!.kind];
          (k.bubble.material as THREE.SpriteMaterial).map = bubbleOf(say[Math.floor(Math.random() * say.length)]);
          (k.bubble.material as THREE.SpriteMaterial).needsUpdate = true;
          k.bubble.visible = true; k.bubbleUntil = t + 1900; k.nextBubble = t + 4000 + Math.random() * 7000;
        }
        if (k.bubble.visible) {
          const left = k.bubbleUntil - t;
          if (left <= 0 || k.where !== 'break' || stopAll) k.bubble.visible = false;
          else { const pop = Math.min(1, (1900 - left) / 160); k.bubble.scale.set(1.3 * pop, 0.65 * pop, 1); k.bubble.position.y = 2.55 + (1 - pop) * -0.3; }
        }
        const pulse = k.tone === 'live' || k.tone === 'shadow' ? 0.9 + Math.sin(s * 3.2) * 0.35 : 0.5;
        (k.lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse * 1.6;
        k.halo.scale.setScalar(0.8 + pulse * 0.5);
        (k.halo.material as THREE.SpriteMaterial).opacity = 0.35 + pulse * 0.3;
        k.zz.forEach((z, i) => {
          if (!z.visible) return;
          const p = ((s * 0.45 + i * 0.5) % 1);
          z.position.set(0.45 + p * 0.5, 1.7 + p * 0.9, 0);
          (z.material as THREE.SpriteMaterial).opacity = Math.sin(p * Math.PI);
        });
        if (k.ring.visible) k.ring.rotation.z = s * 0.6;
        if (k.mail.visible && t > k.mailUntil) k.mail.visible = false;
        if (k.mail.visible) k.mail.position.y = 1.9 + Math.sin(t / 120) * 0.05;
        drawScreen(k, t);
        // Hover: the desk lifts a little.
        const lift = hovered === k.id ? 0.12 : 0;
        k.group.position.y += (lift - k.group.position.y) * 0.2;
      }
      for (let i = flights.length - 1; i >= 0; i--) {
        const f = flights[i];
        const p = Math.min(1, (t - f.t0) / f.dur);
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        f.mesh.position.lerpVectors(f.from, f.to, e);
        f.mesh.position.y += Math.sin(e * Math.PI) * 4;
        f.mesh.material.rotation = Math.sin(t / 150) * 0.2;
        if (p >= 1) {
          scene.remove(f.mesh); f.mesh.material.dispose();
          const k = desks.get(f.target);
          // Work arrived: whoever was on a break walks back to the desk for it.
          if (k) { k.mail.visible = true; k.mailUntil = t + 4000; k.workUntil = t + 30000; k.nextBubble = t + 30000; }
          flights.splice(i, 1);
        }
      }
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    const reset = () => {
      camGoal = home.clone(); targetTo.copy(HOME_TARGET); flyTarget = true;
      controls.autoRotate = spinWanted;
    };
    const setSpinFn = (on: boolean) => { spinWanted = on && !reduce; controls.autoRotate = spinWanted; };
    const toLounge = () => {
      targetTo.set(LOUNGE.x, 0, LOUNGE.z); camGoal = new THREE.Vector3(LOUNGE.x + 6.5, 8.5, LOUNGE.z + 10); flyTarget = true;
      controls.autoRotate = false;
    };
    api.current = { update, fly, reset, lounge: toLounge, setSpin: setSpinFn, setSky };

    return () => {
      cancelAnimationFrame(raf);
      if (idleTimer) clearTimeout(idleTimer);
      ro.disconnect(); io.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointermove', onMove);
      controls.dispose();
      for (const k of desks.values()) (k.label.material as THREE.SpriteMaterial).map?.dispose();
      flights.forEach((f) => f.mesh.material.dispose());
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
    };
    // The scene is built once for the agents that exist; later changes go through update().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.agents.length]);

  // Live state → desks; and sun or moon.
  useEffect(() => { api.current?.update(data, selected); }, [data, selected]);
  useEffect(() => { api.current?.setSky(day); }, [day, data.agents.length]);
  useEffect(() => {
    const t = setInterval(() => setClockDay(isDayInIndia()), 60000);
    return () => clearInterval(t);
  }, []);
  const nextSky = () => {
    const v: SkyMode = skyMode === 'auto' ? 'day' : skyMode === 'day' ? 'night' : 'auto';
    setSkyMode(v);
    try { localStorage.setItem(SKY_KEY, v); } catch { /* private mode */ }
  };
  const skyLabel = skyMode === 'auto' ? `Auto (${day ? 'day' : 'night'})` : day ? 'Day' : 'Night';
  // A new hand-off → an envelope flies.
  useEffect(() => {
    if (!handoff || !handoff.to_agent || handoff.id === lastHandoff.current) return;
    const first = lastHandoff.current === null;
    lastHandoff.current = handoff.id;
    if (!first || Date.now() - new Date(handoff.created_at).getTime() < 120000) api.current?.fly(handoff.agent_id, handoff.to_agent);
  }, [handoff]);

  return (
    <div className={`ai-3d ${day ? 'is-day' : 'is-night'}`}>
      <div className="ai-sky" aria-hidden>
        {day ? <span className="ai-sun" /> : <><span className="ai-stars" /><span className="ai-moon" /></>}
      </div>
      <div ref={host} className="ai-3d-canvas" />
      <div className="ai-3d-tools">
        <button type="button" onClick={() => { const v = !spin; setSpin(v); api.current?.setSpin(v); }} aria-pressed={!spin} title={spin ? 'Stop turning' : 'Turn slowly'}>
          {spin ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}<span>{spin ? 'Stop turning' : 'Turn'}</span>
        </button>
        <button type="button" onClick={nextSky} title="Sky: auto follows India time (day 6 am – 6 pm). Click for day, night, auto.">
          {skyMode === 'auto' ? <SunMoon size={15} aria-hidden /> : day ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}<span>{skyLabel}</span>
        </button>
        <button type="button" onClick={() => api.current?.lounge()} title="Look at the break room"><Coffee size={15} aria-hidden /><span>Break room</span></button>
        <button type="button" onClick={() => api.current?.reset()} title="Back to the whole office"><RotateCcw size={15} aria-hidden /><span>Whole office</span></button>
      </div>
      <p className="ai-3d-hint">Drag to turn · scroll or pinch to zoom · click a desk</p>
      {data.stopAll.on && <div className="ai-3d-stop">All agents stopped — nothing is sent</div>}
    </div>
  );
}
