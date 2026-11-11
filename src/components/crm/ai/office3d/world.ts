import * as THREE from 'three';
import type { Keep, PoseMode } from './mascot';

/**
 * The Vita marketing office as a real place: one floor with walls and windows, four work wings, a glass meeting room,
 * a break lounge (coffee bar, table tennis, sofa) and a terrace with a pool. Also the walking routes between them, so
 * nobody walks through a desk or a wall.
 */

export const B = { x0: -15.2, x1: 15.2, z0: -13.6, z1: 9.9 };
export const POOL = { x0: 19.2, x1: 27.2, z0: -7.1, z1: 1.9, water: -0.14, swimY: -0.64 };
export const TT = { x: 5.5, z: -11.2 };
export const MEET = { x: -10.2, z: -10.5 };
const TERRACE = { x0: B.x1, x1: 31.2, z0: -12.2, z1: 8.8 };
const HALF = Math.PI / 2;

export type Fun = 'ring' | 'swim' | 'edge' | 'lounger' | 'dance' | 'dj' | 'tt' | 'watch' | 'sofa' | 'chat';
export interface Spot { x: number; z: number; y: number; face: number; node: string; pre: [number, number][] }
export interface Slot extends Spot {
  id: string; kind: Fun; zone: 'pool' | 'lounge'; mode: PoseMode; who: string | null;
  /** Spots that move (floating, swimming laps): where it is at this second. */
  drift?: (s: number) => { x: number; z: number; face: number };
}
export interface Seat extends Spot { who: string | null }
export interface DeskParts {
  group: THREE.Group; hit: THREE.Mesh; lamp: THREE.Mesh; halo: THREE.Sprite; screenTex: THREE.CanvasTexture; screenCtx: CanvasRenderingContext2D;
  seat: Spot;
}

export function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
export function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

export function buildWorld(scene: THREE.Scene, keep: Keep, reduce: boolean) {
  // ─── Shared shapes and paints ───
  const G = {
    box: keep(new THREE.BoxGeometry(1, 1, 1)), cyl: keep(new THREE.CylinderGeometry(1, 1, 1, 18)), sphere: keep(new THREE.SphereGeometry(1, 18, 12)),
    cone: keep(new THREE.ConeGeometry(1, 1, 16)), plane: keep(new THREE.PlaneGeometry(1, 1)), circle: keep(new THREE.CircleGeometry(1, 40)),
    torus: keep(new THREE.TorusGeometry(1, 0.2, 10, 24)),
  };
  const paints: Record<string, THREE.MeshStandardMaterial> = {};
  const P = (color: number, roughness = 0.8, metalness = 0) =>
    (paints[`${color}:${roughness}:${metalness}`] ??= keep(new THREE.MeshStandardMaterial({ color, roughness, metalness })));
  type Obj = THREE.Object3D;
  const mesh = (parent: Obj, geo: THREE.BufferGeometry, m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, shadow = true) => {
    const o = new THREE.Mesh(geo, m);
    o.scale.set(sx, sy, sz); o.position.set(x, y, z); o.castShadow = shadow; o.receiveShadow = true;
    parent.add(o);
    return o;
  };
  const box = (parent: Obj, m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, shadow = true) => mesh(parent, G.box, m, w, h, d, x, y, z, shadow);
  const cyl = (parent: Obj, m: THREE.Material, r: number, h: number, x: number, y: number, z: number, shadow = true) => mesh(parent, G.cyl, m, r, h, r, x, y, z, shadow);
  const ball = (parent: Obj, m: THREE.Material, r: number, x: number, y: number, z: number, shadow = true) => mesh(parent, G.sphere, m, r, r, r, x, y, z, shadow);
  const flat = (parent: Obj, m: THREE.Material, w: number, d: number, x: number, y: number, z: number) => {
    const o = new THREE.Mesh(G.plane, m); o.scale.set(w, d, 1); o.rotation.x = -HALF; o.position.set(x, y, z); o.receiveShadow = true; parent.add(o); return o;
  };
  const basic = (color: number, opts: THREE.MeshBasicMaterialParameters = {}) => keep(new THREE.MeshBasicMaterial({ color, ...opts }));

  const world = new THREE.Group();
  scene.add(world);

  // ─── Light: the sun or the moon, and lamps that come on at night ───
  const hemi = new THREE.HemisphereLight(0xffffff, 0xb9c6dc, 1.6); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 26, bottom: -26, near: 1, far: 110 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
  sun.target.position.set(7, 0, -2); scene.add(sun.target); scene.add(sun);
  const fill = new THREE.AmbientLight(0xffffff, 0.3); scene.add(fill);
  const lamps: { l: THREE.PointLight; on: number }[] = [];
  const lamp = (color: number, on: number, reach: number, x: number, y: number, z: number) => {
    const l = new THREE.PointLight(color, 0, reach, 1.5); l.position.set(x, y, z); scene.add(l); lamps.push({ l, on }); return l;
  };
  lamp(0xffe2b0, 30, 22, -7.6, 4.2, 1.2); lamp(0xffe2b0, 30, 22, 7.6, 4.2, 1.2);
  lamp(0xfff0d8, 16, 14, MEET.x, 3.4, MEET.z); lamp(0xffd9a0, 22, 18, 6, 3.6, -10.6);
  lamp(0x4fe3ff, 26, 16, 23.2, 1.6, -2.6);
  const disco = lamp(0xff5fd0, 18, 12, 24.3, 2.6, 5.8);

  // ─── Ground: lawn that fades into the sky, with a hole for the pool ───
  const poolHole = () => {
    const h = new THREE.Path();
    h.moveTo(POOL.x0, -POOL.z1); h.lineTo(POOL.x1, -POOL.z1); h.lineTo(POOL.x1, -POOL.z0); h.lineTo(POOL.x0, -POOL.z0); h.closePath();
    return h;
  };
  const lawnShape = new THREE.Shape(); lawnShape.absarc(8, 2, 60, 0, Math.PI * 2, false); lawnShape.holes.push(poolHole());
  const lawnTex = keep(canvasTexture(512, 512, (c) => {
    const g = c.createRadialGradient(256, 256, 120, 256, 256, 256);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.55, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 512, 512);
  }));
  lawnTex.repeat.set(1 / 120, 1 / 120); lawnTex.offset.set(0.5 - 8 / 120, 0.5 - 2 / 120);
  const lawnMat = keep(new THREE.MeshStandardMaterial({ color: 0xcfe6bf, roughness: 1, map: lawnTex, transparent: true, depthWrite: false }));
  const lawn = new THREE.Mesh(keep(new THREE.ShapeGeometry(lawnShape, 48)), lawnMat);
  lawn.rotation.x = -HALF; lawn.position.y = -0.02; lawn.receiveShadow = true; lawn.renderOrder = -10; world.add(lawn);

  // ─── The office floor ───
  const woodTex = keep(canvasTexture(512, 512, (c) => {
    c.fillStyle = '#d2ae7c'; c.fillRect(0, 0, 512, 512);
    for (let row = 0; row < 8; row++) {
      const off = (row % 2) * 128;
      for (let i = -1; i < 3; i++) {
        const tone = 198 + ((row * 7 + i * 13) % 5) * 5;
        c.fillStyle = `rgb(${tone + 14},${tone - 22},${tone - 78})`;
        c.fillRect(off + i * 256 + 1, row * 64 + 1, 254, 62);
      }
    }
    c.strokeStyle = 'rgba(90,60,30,0.25)'; c.lineWidth = 1;
    for (let y = 0; y <= 512; y += 64) { c.beginPath(); c.moveTo(0, y); c.lineTo(512, y); c.stroke(); }
  }));
  woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping; woodTex.repeat.set(5, 4);
  const BW = B.x1 - B.x0, BD = B.z1 - B.z0, BCX = (B.x0 + B.x1) / 2, BCZ = (B.z0 + B.z1) / 2;
  flat(world, keep(new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.75 })), BW, BD, BCX, 0.015, BCZ);
  box(world, P(0xd9d4ca), BW + 0.5, 0.3, BD + 0.5, BCX, -0.16, BCZ, false);
  const tileTex = (line: string, bg: string) => {
    const t = keep(canvasTexture(128, 128, (c) => { c.fillStyle = bg; c.fillRect(0, 0, 128, 128); c.strokeStyle = line; c.lineWidth = 3; c.strokeRect(0, 0, 64, 64); c.strokeRect(64, 0, 64, 64); c.strokeRect(0, 64, 64, 64); c.strokeRect(64, 64, 64, 64); }));
    t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  };
  // Meeting room carpet and the lounge's lighter floor.
  flat(world, P(0x4b5a78, 1), -4.6 - B.x0, -7.3 - B.z0, (B.x0 - 4.6) / 2, 0.03, (B.z0 - 7.3) / 2);
  const loungeTex = tileTex('rgba(150,130,100,0.35)', '#efe6d6'); loungeTex.repeat.set(10, 3.2);
  flat(world, keep(new THREE.MeshStandardMaterial({ map: loungeTex, roughness: 0.6 })), B.x1 + 4.6, -7.3 - B.z0, (B.x1 - 4.6) / 2, 0.03, (B.z0 - 7.3) / 2);

  // ─── Walls: full height with windows. A wall hides when the camera is behind it, so the inside is always in view. ───
  const WALL_H = 2.6;
  const wallPaint = P(0xf4f0e8, 0.9), trim = P(0xffffff, 0.6), cap = P(0xb98a55, 0.7), steel = P(0xaab2c0, 0.4, 0.6);
  const glassPane = keep(new THREE.MeshBasicMaterial({ color: 0xcdeaff }));
  const sides = { n: new THREE.Group(), s: new THREE.Group(), w: new THREE.Group() };
  Object.values(sides).forEach((g) => world.add(g));
  // Kerbs that always stay, so the outline of the building never disappears.
  box(world, wallPaint, BW + 0.2, 0.14, 0.2, BCX, 0.07, B.z0, false); box(world, wallPaint, BW + 0.2, 0.14, 0.2, BCX, 0.07, B.z1, false);
  box(world, wallPaint, 0.2, 0.14, BD, B.x0, 0.07, BCZ, false);
  box(sides.n, wallPaint, BW + 0.2, WALL_H, 0.2, BCX, WALL_H / 2, B.z0); box(sides.n, cap, BW + 0.3, 0.08, 0.3, BCX, WALL_H + 0.04, B.z0, false);
  box(sides.w, wallPaint, 0.2, WALL_H, BD, B.x0, WALL_H / 2, BCZ); box(sides.w, cap, 0.3, 0.08, BD + 0.3, B.x0, WALL_H + 0.04, BCZ, false);
  // South wall with the front door in the middle.
  for (const [a, b] of [[B.x0, -1.3], [1.3, B.x1]]) {
    box(sides.s, wallPaint, b - a, WALL_H, 0.2, (a + b) / 2, WALL_H / 2, B.z1); box(sides.s, cap, b - a + 0.1, 0.08, 0.3, (a + b) / 2, WALL_H + 0.04, B.z1, false);
  }
  box(sides.s, wallPaint, 2.6, 0.5, 0.2, 0, WALL_H - 0.25, B.z1, false);
  flat(world, P(0x3a4a66, 1), 2.2, 1.1, 0, 0.035, B.z1 - 0.8);
  const windowOn = (g: THREE.Group, x: number, z: number, along: 'x' | 'z', inward: 1 | -1, w = 2.3) => {
    const pane = new THREE.Mesh(G.plane, glassPane); pane.scale.set(w, 1.3, 1);
    const f = (fw: number, fh: number, ox: number, oy: number) => {
      const b = new THREE.Mesh(G.box, trim);
      if (along === 'x') { b.scale.set(fw, fh, 0.06); b.position.set(x + ox, 1.55 + oy, z + inward * 0.115); }
      else { b.scale.set(0.06, fh, fw); b.position.set(x + inward * 0.115, 1.55 + oy, z + ox); }
      g.add(b);
    };
    if (along === 'x') { pane.position.set(x, 1.55, z + inward * 0.105); if (inward < 0) pane.rotation.y = Math.PI; }
    else { pane.position.set(x + inward * 0.105, 1.55, z); pane.rotation.y = inward * HALF; }
    g.add(pane);
    f(w + 0.12, 0.07, 0, 0.68); f(w + 0.12, 0.07, 0, -0.68); f(0.07, 1.36, -w / 2, 0); f(0.07, 1.36, w / 2, 0); f(0.05, 1.3, 0, 0);
  };
  for (const x of [-12.6, -8.2, 4.4, 8.2, 12.8]) windowOn(sides.n, x, B.z0, 'x', 1);
  for (const z of [-4.6, -0.6, 3.6, 7.4]) windowOn(sides.w, B.x0, z, 'z', 1);
  for (const x of [-12, -8, -4.4, 4.4, 8, 12]) windowOn(sides.s, x, B.z1, 'x', -1);
  // The wall sign and a clock that shows India time.
  const sign = new THREE.Mesh(G.plane, basic(0xffffff, { map: keep(canvasTexture(1024, 192, (c) => {
    c.fillStyle = '#0e1525'; roundRect(c, 4, 4, 1016, 184, 40); c.fill();
    c.fillStyle = '#ffffff'; c.font = '800 92px Inter, system-ui, sans-serif'; c.textBaseline = 'middle'; c.fillText('Vita', 60, 100);
    c.fillStyle = '#38f6a9'; c.font = '700 64px Inter, system-ui, sans-serif'; c.fillText('Marketing Office', 270, 104);
  })), transparent: true }));
  sign.scale.set(3.8, 0.71, 1); sign.position.set(-1.5, 2.05, B.z0 + 0.11); sides.n.add(sign);
  const clockCv = document.createElement('canvas'); clockCv.width = 128; clockCv.height = 128;
  const clockTex = keep(new THREE.CanvasTexture(clockCv)); clockTex.colorSpace = THREE.SRGBColorSpace;
  const clock = new THREE.Mesh(G.circle, basic(0xffffff, { map: clockTex })); clock.scale.setScalar(0.34); clock.position.set(1.6, 2.05, B.z0 + 0.11); sides.n.add(clock);
  let clockMinute = -1;
  const drawClock = () => {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0), m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    if (m === clockMinute) return;
    clockMinute = m;
    const c = clockCv.getContext('2d')!;
    c.fillStyle = '#ffffff'; c.beginPath(); c.arc(64, 64, 62, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#0e1525'; c.lineWidth = 6; c.stroke();
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; c.lineWidth = 3; c.beginPath(); c.moveTo(64 + Math.sin(a) * 50, 64 - Math.cos(a) * 50); c.lineTo(64 + Math.sin(a) * 56, 64 - Math.cos(a) * 56); c.stroke(); }
    const hand = (a: number, len: number, w: number) => { c.lineWidth = w; c.lineCap = 'round'; c.beginPath(); c.moveTo(64, 64); c.lineTo(64 + Math.sin(a) * len, 64 - Math.cos(a) * len); c.stroke(); };
    hand(((h % 12) + m / 60) / 12 * Math.PI * 2, 30, 7); hand((m / 60) * Math.PI * 2, 46, 4);
    clockTex.needsUpdate = true;
  };
  drawClock();

  // East side: a glass front onto the terrace, with the door open.
  const glass = keep(new THREE.MeshPhysicalMaterial({ color: 0xbfe1ff, transparent: true, opacity: 0.16, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }));
  const frost = keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
  const glassWall = (x0: number, z0: number, x1: number, z1: number, h = 2.3) => {
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0), len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const pane = box(world, glass, alongX ? len : 0.03, h, alongX ? 0.03 : len, cx, h / 2, cz, false); pane.receiveShadow = false; pane.renderOrder = 5;
    const band = box(world, frost, alongX ? len : 0.035, 0.5, alongX ? 0.035 : len, cx, 1.15, cz, false); band.receiveShadow = false; band.renderOrder = 6;
    box(world, steel, alongX ? len : 0.07, 0.06, alongX ? 0.07 : len, cx, h, cz, false); box(world, steel, alongX ? len : 0.07, 0.06, alongX ? 0.07 : len, cx, 0.05, cz, false);
    const posts = Math.max(1, Math.round(len / 2.6));
    for (let i = 0; i <= posts; i++) { const f = i / posts; box(world, steel, 0.07, h, 0.07, x0 + (x1 - x0) * f, h / 2, z0 + (z1 - z0) * f, false); }
  };
  glassWall(B.x1, B.z0, B.x1, 0.3, 2.6); glassWall(B.x1, 2.1, B.x1, B.z1, 2.6);
  // The meeting room's glass walls, with its door near the corner.
  glassWall(B.x0, -7.3, -4.6, -7.3); glassWall(-4.6, B.z0, -4.6, -9.4); glassWall(-4.6, -7.9, -4.6, -7.3);
  const door = box(world, glass, 0.03, 2.1, 1.4, -4.05, 1.05, -9.75, false); door.rotation.y = -0.9; door.renderOrder = 5;

  // Planters that mark off the lounge from the work floor.
  const leaf = P(0x2f8f5b, 0.9), leaf2 = P(0x3fa76a, 0.9), pot = P(0xe9e2d6, 0.8), soil = P(0x5a4634, 1);
  const plant = (x: number, z: number, s = 1) => {
    cyl(world, pot, 0.26 * s, 0.5 * s, x, 0.25 * s, z);
    ball(world, leaf, 0.42 * s, x, 0.86 * s, z); ball(world, leaf2, 0.3 * s, x + 0.2 * s, 1.14 * s, z - 0.08); ball(world, leaf, 0.26 * s, x - 0.2 * s, 1.08 * s, z + 0.1);
  };
  const planter = (x0: number, x1: number, z: number) => {
    box(world, pot, x1 - x0, 0.7, 0.5, (x0 + x1) / 2, 0.35, z); box(world, soil, x1 - x0 - 0.1, 0.04, 0.4, (x0 + x1) / 2, 0.71, z, false);
    for (let x = x0 + 0.5; x < x1 - 0.2; x += 0.9) { ball(world, (Math.round(x * 10) % 2 ? leaf : leaf2), 0.34, x, 0.98, z); }
  };
  planter(2.2, 14.6, -7.3); planter(-4.3, -1.9, -7.3);
  plant(14.4, -8.3, 1.2); plant(-14.4, 9.1, 1.2); plant(14.4, 9.1, 1.2); plant(-14.4, -6.6, 1.1); plant(-1.9, 9.2); plant(1.9, 9.2);

  // ─── Furniture pieces used in several rooms ───
  const chairDark = P(0x2a3550, 0.85), chairBase = P(0x1c2233, 0.5, 0.5);
  const officeChair = (parent: Obj, x: number, z: number, face: number, seatPaint: THREE.Material = chairDark) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = face; parent.add(g);
    cyl(g, chairBase, 0.3, 0.04, 0, 0.05, 0, false); cyl(g, chairBase, 0.035, 0.36, 0, 0.24, 0, false);
    box(g, seatPaint, 0.52, 0.09, 0.5, 0, 0.44, 0); box(g, seatPaint, 0.48, 0.56, 0.08, 0, 0.82, -0.26);
    box(g, chairBase, 0.05, 0.05, 0.3, -0.28, 0.62, -0.02, false); box(g, chairBase, 0.05, 0.05, 0.3, 0.28, 0.62, -0.02, false);
    return g;
  };
  const mugOn = (parent: Obj, x: number, y: number, z: number, color = 0xffffff) => cyl(parent, P(color, 0.4), 0.05, 0.1, x, y + 0.05, z, false);

  // ─── A proper desk: wooden top, drawers, monitor, keyboard, chair, a cubicle screen with the name plate ───
  const deskWood = P(0xdcbb8c, 0.6), deskWhite = P(0xf2f3f6, 0.5), dark = P(0x141a28, 0.4, 0.3), keys = P(0x232a3c, 0.6), paper = P(0xffffff, 0.9);
  const hitMat = basic(0xffffff, { visible: false });
  const haloTex = keep(canvasTexture(128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.35, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  }));
  const fabric: Record<number, THREE.Material> = {};
  const makeDesk = (x: number, z: number, wingColor: number, name: string, index: number, aisleZ: number, junction: string): DeskParts => {
    const g = new THREE.Group(); g.position.set(x, 0, z); world.add(g);
    // Top, side frames, back panel and a three-drawer pedestal.
    box(g, deskWood, 1.8, 0.05, 0.82, 0, 0.745, 0.35);
    box(g, deskWhite, 0.04, 0.72, 0.76, -0.86, 0.36, 0.35); box(g, deskWhite, 0.04, 0.72, 0.76, 0.86, 0.36, 0.35);
    box(g, deskWhite, 1.68, 0.4, 0.03, 0, 0.5, 0.72, false);
    box(g, deskWhite, 0.42, 0.62, 0.55, -0.6, 0.31, 0.3);
    for (const y of [0.14, 0.34, 0.52]) box(g, steel, 0.2, 0.015, 0.012, -0.6, y, 0.02, false);
    // Monitor on its stand, turned towards the chair, with a live screen.
    const mon = new THREE.Group(); mon.position.set(0.52, 0.77, 0.54); mon.rotation.y = Math.PI + 0.42; g.add(mon);
    box(mon, dark, 0.26, 0.02, 0.18, 0, 0.01, 0, false); box(mon, dark, 0.05, 0.26, 0.04, 0, 0.14, -0.02, false);
    box(mon, dark, 0.84, 0.5, 0.04, 0, 0.5, 0);
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 144;
    const screenCtx = cv.getContext('2d')!;
    const screenTex = keep(new THREE.CanvasTexture(cv)); screenTex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(G.plane, keep(new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false })));
    screen.scale.set(0.78, 0.44, 1); screen.position.set(0, 0.5, 0.022); mon.add(screen);
    // Keyboard, mouse, mug, papers.
    box(g, keys, 0.44, 0.02, 0.15, 0.02, 0.78, 0.17, false); box(g, keys, 0.06, 0.025, 0.1, 0.36, 0.78, 0.15, false);
    mugOn(g, -0.62, 0.77, 0.52, [0xffffff, 0x7ad3ff, 0xffb74d, 0xb48cff][index % 4]);
    box(g, paper, 0.24, 0.03, 0.32, -0.3, 0.785, 0.5, false);
    if (index % 2 === 0) { cyl(g, pot, 0.07, 0.1, 0.72, 0.82, 0.6, false); ball(g, leaf2, 0.12, 0.72, 0.95, 0.6, false); }
    officeChair(g, 0, -0.5, 0);
    // The cubicle screen behind, in the wing's colour, with the name plate.
    fabric[wingColor] ??= keep(new THREE.MeshStandardMaterial({ color: new THREE.Color(wingColor).lerp(new THREE.Color(0x9aa3b5), 0.45), roughness: 1 }));
    box(g, fabric[wingColor], 2.1, 1.25, 0.07, 0, 0.625, -1.25); box(g, fabric[wingColor], 0.07, 1.25, 1.0, -1.05, 0.625, -0.78);
    box(g, steel, 2.14, 0.04, 0.09, 0, 1.27, -1.25, false);
    const plate = new THREE.Mesh(G.plane, basic(0xffffff, { map: keep(canvasTexture(512, 112, (c) => {
      c.fillStyle = '#ffffff'; roundRect(c, 2, 2, 508, 108, 20); c.fill();
      c.fillStyle = hex(wingColor); c.fillRect(2, 2, 16, 108);
      c.fillStyle = '#0e1525'; c.font = '700 50px Inter, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(name, 264, 60, 460);
    })) }));
    plate.scale.set(1.1, 0.24, 1); plate.position.set(0, 0.98, -1.21); g.add(plate);
    // The status light on the corner of the screen.
    const lampMat = keep(new THREE.MeshStandardMaterial({ color: 0x8090ad, emissive: 0x8090ad, emissiveIntensity: 1.2 }));
    cyl(g, steel, 0.02, 0.2, 0.98, 1.38, -1.25, false);
    const lampMesh = new THREE.Mesh(G.sphere, lampMat); lampMesh.scale.setScalar(0.1); lampMesh.position.set(0.98, 1.52, -1.25); g.add(lampMesh);
    const halo = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: haloTex, color: 0x8090ad, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
    halo.position.copy(lampMesh.position); g.add(halo);
    const hit = new THREE.Mesh(G.box, hitMat); hit.scale.set(2.2, 1.5, 2.2); hit.position.set(0, 0.75, -0.2); g.add(hit);
    return {
      group: g, hit, lamp: lampMesh, halo, screenTex, screenCtx,
      seat: { x, z: z - 0.5, y: 0.36, face: 0, node: junction, pre: [[x + 1.62, aisleZ], [x + 1.62, z - 0.5]] },
    };
  };

  // ─── Meeting room ───
  const tableWood = P(0x8a6848, 0.5);
  const top = cyl(world, tableWood, 1, 0.07, MEET.x, 0.745, MEET.z); top.scale.set(2.5, 0.07, 0.95);
  cyl(world, chairBase, 0.16, 0.7, MEET.x - 1.2, 0.36, MEET.z); cyl(world, chairBase, 0.16, 0.7, MEET.x + 1.2, 0.36, MEET.z);
  box(world, dark, 0.42, 0.02, 0.3, MEET.x - 0.5, 0.795, MEET.z + 0.2, false); box(world, paper, 0.3, 0.02, 0.4, MEET.x + 0.9, 0.79, MEET.z - 0.15, false);
  mesh(world, G.cone, dark, 0.14, 0.08, 0.14, MEET.x + 0.1, 0.82, MEET.z, false);
  const seats: Seat[] = [];
  const meetChair = (x: number, z: number, face: number, node: string, pre: [number, number][]) => {
    officeChair(world, x, z, face, P(0x38507a, 0.85));
    seats.push({ x, z, y: 0.36, face, node, pre, who: null });
  };
  for (const x of [-10.2, -11.9, -8.5]) meetChair(x, -9.25, Math.PI, 'm.se', [[x, -8.2]]);
  for (const x of [-10.2, -8.5, -11.9]) meetChair(x, -11.75, 0, 'm.ne', [[x, -12.75]]);
  meetChair(-7.3, MEET.z, -HALF, 'm.se', [[-6.2, MEET.z]]);
  // The screen on the wall: today's real numbers.
  const tvCv = document.createElement('canvas'); tvCv.width = 512; tvCv.height = 288;
  const tvTex = keep(new THREE.CanvasTexture(tvCv)); tvTex.colorSpace = THREE.SRGBColorSpace;
  box(sides.w, dark, 0.07, 1.56, 2.72, B.x0 + 0.14, 1.5, MEET.z, false);
  const tv = new THREE.Mesh(G.plane, keep(new THREE.MeshBasicMaterial({ map: tvTex, toneMapped: false })));
  tv.scale.set(2.6, 1.46, 1); tv.rotation.y = HALF; tv.position.set(B.x0 + 0.18, 1.5, MEET.z); sides.w.add(tv);
  const drawTv = (title: string, tiles: { label: string; value: string; color: string }[], line: string) => {
    const c = tvCv.getContext('2d')!;
    c.fillStyle = '#0b1220'; c.fillRect(0, 0, 512, 288);
    c.fillStyle = '#ffffff'; c.font = '700 26px Inter, system-ui, sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'left'; c.fillText(title, 24, 34, 464);
    tiles.slice(0, 4).forEach((tile, i) => {
      const x = 24 + i * 118;
      c.fillStyle = '#16213a'; roundRect(c, x, 64, 108, 120, 14); c.fill();
      c.fillStyle = tile.color; c.font = '800 54px Inter, system-ui, sans-serif'; c.textAlign = 'center'; c.fillText(tile.value, x + 54, 112, 96);
      c.fillStyle = '#b9c6e2'; c.font = '600 17px Inter, system-ui, sans-serif'; c.fillText(tile.label, x + 54, 162, 100);
    });
    c.textAlign = 'left'; c.fillStyle = '#7fd3ff'; c.font = '600 19px Inter, system-ui, sans-serif';
    const words = line.split(' '); let row = '', y = 218;
    for (const w of words) { if (c.measureText(row + w).width > 460 && row) { c.fillText(row, 24, y); row = ''; y += 26; if (y > 270) break; } row += w + ' '; }
    if (y <= 270) c.fillText(row, 24, y);
    tvTex.needsUpdate = true;
  };
  plant(-14.3, -12.8, 1.1);

  // ─── Lounge: coffee bar, table tennis, sofa ───
  const counter = P(0x2f3b57, 0.7);
  box(world, counter, 4.8, 0.92, 0.7, -1.4, 0.46, -13.0); box(world, deskWood, 5.0, 0.06, 0.8, -1.4, 0.95, -13.0);
  box(world, dark, 0.5, 0.55, 0.42, -2.9, 1.26, -13.05); box(world, steel, 0.3, 0.06, 0.2, -2.9, 1.05, -12.85, false); cyl(world, P(0xe5484d, 0.5), 0.05, 0.08, -2.9, 1.56, -13.05, false);
  for (let i = 0; i < 4; i++) mugOn(world, -1.9 + i * 0.22, 0.98, -13.1, [0xffffff, 0xffb74d, 0x7ad3ff, 0xffffff][i]);
  box(world, P(0xc9a27a, 0.7), 0.5, 0.08, 0.34, -0.3, 1.02, -13.0, false); ball(world, P(0xe9a23b, 0.8), 0.07, -0.4, 1.12, -13.0, false); ball(world, P(0xe9a23b, 0.8), 0.07, -0.22, 1.12, -12.96, false);
  box(world, P(0xd7dce6, 0.35, 0.5), 0.85, 1.95, 0.75, 1.9, 0.975, -13.05); box(world, steel, 0.03, 0.7, 0.04, 1.58, 1.2, -12.66, false);
  for (const x of [-2.5, -0.5]) { cyl(world, chairBase, 0.03, 0.66, x + (x < -1.5 ? -0.75 : 0.75), 0.33, -12.15, false); cyl(world, P(0xb98a55, 0.6), 0.2, 0.06, x + (x < -1.5 ? -0.75 : 0.75), 0.69, -12.15); }
  // Table tennis on its court mat.
  flat(world, P(0x2d5d4a, 1), 6.2, 4.2, TT.x, 0.035, TT.z);
  box(world, P(0x1f6fb5, 0.5), 2.74, 0.06, 1.52, TT.x, 0.76, TT.z); box(world, trim, 2.74, 0.062, 0.03, TT.x, 0.761, TT.z, false);
  box(world, keep(new THREE.MeshStandardMaterial({ color: 0xf2f5fb, transparent: true, opacity: 0.85 })), 0.03, 0.16, 1.62, TT.x, 0.87, TT.z, false);
  for (const [lx, lz] of [[-1.2, -0.62], [1.2, -0.62], [-1.2, 0.62], [1.2, 0.62]]) box(world, chairBase, 0.07, 0.73, 0.07, TT.x + lx, 0.365, TT.z + lz, false);
  // Sofa with a coffee table on a rug, and a floor lamp.
  flat(world, P(0xf0a868, 1), 5.4, 3.8, 11.6, 0.035, -11.5);
  const sofa = P(0x7c5cff, 0.9), cushion = P(0x9478ff, 0.9);
  box(world, sofa, 3.6, 0.42, 0.95, 11.6, 0.23, -12.75); box(world, sofa, 3.6, 0.8, 0.24, 11.6, 0.6, -13.25);
  box(world, sofa, 0.24, 0.62, 0.95, 9.9, 0.33, -12.75); box(world, sofa, 0.24, 0.62, 0.95, 13.3, 0.33, -12.75);
  for (const x of [10.6, 11.6, 12.6]) box(world, cushion, 0.92, 0.1, 0.8, x, 0.47, -12.7, false);
  box(world, deskWood, 1.5, 0.06, 0.7, 11.6, 0.4, -10.6); for (const [lx, lz] of [[-0.65, -0.28], [0.65, -0.28], [-0.65, 0.28], [0.65, 0.28]]) box(world, chairBase, 0.05, 0.38, 0.05, 11.6 + lx, 0.19, -10.6 + lz, false);
  mugOn(world, 11.3, 0.43, -10.55); mugOn(world, 11.9, 0.43, -10.7, 0xffb74d);
  const bowl = new THREE.Mesh(keep(new THREE.SphereGeometry(0.17, 16, 10, 0, Math.PI * 2, HALF, HALF)), P(0xe57373, 0.6)); bowl.position.set(11.6, 0.6, -10.5); world.add(bowl);
  cyl(world, chairBase, 0.03, 1.7, 14.2, 0.85, -12.9, false); cyl(world, chairBase, 0.22, 0.04, 14.2, 0.02, -12.9, false);
  const shade = keep(new THREE.MeshStandardMaterial({ color: 0xfff1cf, emissive: 0xffd9a0, emissiveIntensity: 0.2, roughness: 0.8 }));
  mesh(world, G.cone, shade, 0.34, 0.4, 0.34, 14.2, 1.85, -12.9, false);

  // ─── Terrace and pool ───
  const deckShape = new THREE.Shape();
  deckShape.moveTo(TERRACE.x0, -TERRACE.z1); deckShape.lineTo(TERRACE.x1, -TERRACE.z1); deckShape.lineTo(TERRACE.x1, -TERRACE.z0); deckShape.lineTo(TERRACE.x0, -TERRACE.z0); deckShape.closePath();
  deckShape.holes.push(poolHole());
  const deckTex = tileTex('rgba(140,120,95,0.4)', '#ecdfc8'); deckTex.repeat.set(1 / 2.4, 1 / 2.4);
  const deck = new THREE.Mesh(keep(new THREE.ShapeGeometry(deckShape)), keep(new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.85 })));
  deck.rotation.x = -HALF; deck.position.y = 0.02; deck.receiveShadow = true; world.add(deck);
  const PW = POOL.x1 - POOL.x0, PD = POOL.z1 - POOL.z0, PCX = (POOL.x0 + POOL.x1) / 2, PCZ = (POOL.z0 + POOL.z1) / 2;
  const poolTile = tileTex('rgba(255,255,255,0.55)', '#7fd6ee'); poolTile.repeat.set(8, 9);
  const poolPaint = keep(new THREE.MeshStandardMaterial({ map: poolTile, roughness: 0.5 }));
  flat(world, poolPaint, PW, PD, PCX, -1.0, PCZ);
  box(world, P(0x8fdcf2, 0.5), 0.1, 1.04, PD, POOL.x0 - 0.05, -0.5, PCZ, false); box(world, P(0x8fdcf2, 0.5), 0.1, 1.04, PD, POOL.x1 + 0.05, -0.5, PCZ, false);
  box(world, P(0x8fdcf2, 0.5), PW + 0.2, 1.04, 0.1, PCX, -0.5, POOL.z0 - 0.05, false); box(world, P(0x8fdcf2, 0.5), PW + 0.2, 1.04, 0.1, PCX, -0.5, POOL.z1 + 0.05, false);
  const coping = P(0xf7f3ea, 0.7);
  box(world, coping, 0.34, 0.08, PD + 0.68, POOL.x0 - 0.17, 0.06, PCZ, false); box(world, coping, 0.34, 0.08, PD + 0.68, POOL.x1 + 0.17, 0.06, PCZ, false);
  box(world, coping, PW, 0.08, 0.34, PCX, 0.06, POOL.z0 - 0.17, false); box(world, coping, PW, 0.08, 0.34, PCX, 0.06, POOL.z1 + 0.17, false);
  const waterTex = keep(canvasTexture(256, 256, (c) => {
    c.fillStyle = '#35c4e8'; c.fillRect(0, 0, 256, 256);
    c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 3;
    for (let i = 0; i < 9; i++) {
      c.beginPath();
      for (let x = 0; x <= 256; x += 8) { const y = i * 30 + Math.sin((x / 256) * Math.PI * 4 + i * 1.3) * 9; if (x === 0) c.moveTo(x, y); else c.lineTo(x, y); }
      c.stroke();
    }
  }));
  waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping; waterTex.repeat.set(2, 2.2);
  const waterMat = keep(new THREE.MeshStandardMaterial({ color: 0xffffff, map: waterTex, transparent: true, opacity: 0.74, roughness: 0.08, emissive: 0x0b7ea0, emissiveIntensity: 0.15 }));
  const water = flat(world, waterMat, PW, PD, PCX, POOL.water, PCZ); water.renderOrder = 4;
  // Ladder.
  for (const z of [-6.5, -6.0]) { const rail = new THREE.Mesh(keep(new THREE.TorusGeometry(0.32, 0.03, 8, 16, Math.PI)), steel); rail.position.set(POOL.x1, 0.1, z); rail.rotation.y = 0; world.add(rail); }
  // A spare float drifting about.
  const spare = new THREE.Mesh(G.torus, P(0x7dffb2, 0.45)); spare.scale.set(0.5, 0.5, 0.85); spare.rotation.x = HALF; spare.position.set(21.0, POOL.water + 0.05, 0.6); world.add(spare);
  // Hedges around the terrace.
  const hedge = P(0x3f8f52, 1);
  box(world, hedge, TERRACE.x1 - TERRACE.x0 - 0.6, 0.8, 0.6, (TERRACE.x0 + TERRACE.x1) / 2 + 0.3, 0.4, TERRACE.z0 + 0.1); box(world, hedge, 0.6, 0.8, TERRACE.z1 - TERRACE.z0, TERRACE.x1 - 0.1, 0.4, (TERRACE.z0 + TERRACE.z1) / 2);
  box(world, hedge, TERRACE.x1 - TERRACE.x0 - 0.6, 0.8, 0.6, (TERRACE.x0 + TERRACE.x1) / 2 + 0.3, 0.4, TERRACE.z1 - 0.1);
  // Sun loungers with umbrellas.
  const loungeFrame = P(0xffffff, 0.6), towel = [P(0xff8a65, 0.9), P(0x4fc3f7, 0.9), P(0xffd54f, 0.9)];
  [20.6, 23.2, 25.8].forEach((x, i) => {
    box(world, loungeFrame, 0.74, 0.08, 1.9, x, 0.3, -10.2); box(world, towel[i], 0.62, 0.03, 1.5, x, 0.355, -10.05, false);
    const back = box(world, loungeFrame, 0.74, 0.08, 0.8, x, 0.56, -11.0); back.rotation.x = 0.85;
    for (const [lx, lz] of [[-0.3, -0.8], [0.3, -0.8], [-0.3, 0.8], [0.3, 0.8]]) box(world, steel, 0.04, 0.28, 0.04, x + lx, 0.14, -10.2 + lz, false);
  });
  const umbrella = (x: number, z: number, a: number, b: number) => {
    cyl(world, steel, 0.035, 2.6, x, 1.3, z, false); cyl(world, P(0xd7dce6), 0.2, 0.06, x, 0.03, z, false);
    const canopy = new THREE.Mesh(keep(new THREE.ConeGeometry(1.55, 0.55, 12, 1, true)), keep(new THREE.MeshStandardMaterial({ color: a, roughness: 0.9, side: THREE.DoubleSide })));
    canopy.position.set(x, 2.55, z); canopy.castShadow = true; world.add(canopy);
    const stripe = new THREE.Mesh(keep(new THREE.ConeGeometry(1.57, 0.56, 12, 1, true, 0, Math.PI / 6)), keep(new THREE.MeshStandardMaterial({ color: b, roughness: 0.9, side: THREE.DoubleSide })));
    for (let i = 0; i < 6; i++) { const s = stripe.clone(); s.rotation.y = (i / 6) * Math.PI * 2; s.position.set(x, 2.552, z); world.add(s); }
    box(world, P(0xffffff, 0.6), 0.5, 0.04, 0.5, x, 0.5, z + 0.9); cyl(world, steel, 0.03, 0.5, x, 0.25, z + 0.9, false);
    cyl(world, keep(new THREE.MeshStandardMaterial({ color: 0xffa94d, transparent: true, opacity: 0.85, roughness: 0.2 })), 0.05, 0.16, x + 0.1, 0.6, z + 0.9, false);
  };
  umbrella(21.9, -11.0, 0xff6b6b, 0xffffff); umbrella(24.5, -11.0, 0x2ec4b6, 0xffffff);
  // Palm trees.
  const trunk = P(0x9b7653, 1), frond = keep(new THREE.MeshStandardMaterial({ color: 0x2f9e5f, roughness: 0.9, side: THREE.DoubleSide }));
  const palm = (x: number, z: number, h: number, lean: number) => {
    for (let i = 0; i < 6; i++) { const f = i / 5; cyl(world, trunk, 0.2 - f * 0.07, h / 6 + 0.02, x + Math.sin(f * 1.4) * lean, (i + 0.5) * (h / 6), z, i === 5); }
    const tx = x + Math.sin(1.4) * lean;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const leafG = new THREE.Group(); leafG.position.set(tx, h, z); leafG.rotation.y = a; world.add(leafG);
      const l = mesh(leafG, G.sphere, frond, 0.24, 0.03, 1.15, 0, -0.18, 1.0); l.rotation.x = 0.42;
    }
    ball(world, P(0x6b4a2f, 0.9), 0.14, tx + 0.12, h - 0.18, z + 0.1, false); ball(world, P(0x6b4a2f, 0.9), 0.13, tx - 0.12, h - 0.2, z - 0.06, false);
  };
  palm(29.6, -11.0, 4.2, 0.5); palm(29.8, 7.4, 3.8, -0.4); palm(16.6, 7.6, 4.4, 0.35); palm(17.0, -11.0, 3.6, -0.3);
  // The party corner: a dance floor, the DJ's desk and speakers.
  const floorCv = document.createElement('canvas'); floorCv.width = 256; floorCv.height = 256;
  const floorTex = keep(new THREE.CanvasTexture(floorCv)); floorTex.colorSpace = THREE.SRGBColorSpace;
  const drawDance = (step: number) => {
    const c = floorCv.getContext('2d')!;
    const cols = ['#ff5fa2', '#ffd23f', '#38f6a9', '#5cc8ff', '#b48cff'];
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { c.fillStyle = cols[(i * 2 + j * 3 + step) % cols.length]; c.globalAlpha = (i + j + step) % 2 ? 0.95 : 0.55; c.fillRect(i * 43, j * 43, 42, 42); }
    c.globalAlpha = 1; floorTex.needsUpdate = true;
  };
  drawDance(0);
  const danceMat = keep(new THREE.MeshStandardMaterial({ map: floorTex, emissiveMap: floorTex, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.4 }));
  const dance = new THREE.Mesh(G.circle, danceMat); dance.scale.setScalar(2.2); dance.rotation.x = -HALF; dance.position.set(24.3, 0.04, 5.8); dance.receiveShadow = true; world.add(dance);
  box(world, P(0x1b2238, 0.5), 0.8, 1.0, 2.0, 21.0, 0.5, 5.9); box(world, P(0x38f6a9, 0.5), 0.04, 0.5, 1.6, 21.42, 0.6, 5.9, false);
  cyl(world, dark, 0.26, 0.04, 21.0, 1.03, 5.4, false); cyl(world, dark, 0.26, 0.04, 21.0, 1.03, 6.4, false); box(world, steel, 0.3, 0.02, 0.24, 21.0, 1.02, 5.9, false);
  const cone = P(0x5a6b95, 0.3);
  for (const z of [4.3, 7.5]) {
    box(world, P(0x12182a, 0.5), 0.7, 1.6, 0.8, 20.7, 0.8, z);
    for (const [y, r] of [[1.2, 0.2], [0.55, 0.27]] as const) { const c = new THREE.Mesh(G.circle, cone); c.scale.setScalar(r); c.rotation.y = HALF; c.position.set(21.06, y, z); world.add(c); }
  }
  // The banner.
  cyl(world, steel, 0.04, 3.3, 19.8, 1.65, -11.6, false); cyl(world, steel, 0.04, 3.3, 26.6, 1.65, -11.6, false);
  const banner = new THREE.Mesh(G.plane, basic(0xffffff, { side: THREE.DoubleSide, map: keep(canvasTexture(1024, 160, (c) => {
    const cols = ['#ff5fa2', '#ffb02e', '#38c6f4', '#7c5cff', '#2ec4b6'];
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, 1024, 160);
    for (let i = 0; i < 16; i++) { c.fillStyle = cols[i % cols.length]; c.beginPath(); c.moveTo(i * 64, 0); c.lineTo(i * 64 + 64, 0); c.lineTo(i * 64 + 32, 34); c.closePath(); c.fill(); }
    c.font = '900 92px Inter, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    'POOL PARTY'.split('').forEach((ch, i) => { c.fillStyle = cols[i % cols.length]; c.fillText(ch, 150 + i * 80, 98); });
  })) }));
  banner.scale.set(6.6, 1.03, 1); banner.position.set(23.2, 2.75, -11.6); world.add(banner);
  // Party lights strung around the pool.
  const poles: [number, number][] = [[17.5, -8.9], [28.9, -8.9], [28.9, 3.7], [17.5, 3.7]];
  poles.forEach(([x, z]) => cyl(world, steel, 0.04, 3.1, x, 1.55, z, false));
  const bulbsPer = 13, bulbCount = bulbsPer * 4;
  const bulbs = new THREE.InstancedMesh(keep(new THREE.SphereGeometry(0.075, 8, 6)), basic(0xffffff), bulbCount);
  const bulbColors = [0xffd166, 0xff6fa5, 0x7ad3ff, 0x7dffb2];
  const dummy = new THREE.Object3D(), wire: number[] = [];
  let bi = 0;
  poles.forEach(([x0, z0], p) => {
    const [x1, z1] = poles[(p + 1) % 4];
    for (let i = 0; i <= bulbsPer; i++) {
      const f = i / bulbsPer, y = 3.05 - Math.sin(f * Math.PI) * 0.55;
      wire.push(x0 + (x1 - x0) * f, y, z0 + (z1 - z0) * f);
      if (i > 0 && bi < bulbCount) { dummy.position.set(x0 + (x1 - x0) * (f - 0.5 / bulbsPer), y - 0.08, z0 + (z1 - z0) * (f - 0.5 / bulbsPer)); dummy.updateMatrix(); bulbs.setMatrixAt(bi, dummy.matrix); bulbs.setColorAt(bi, new THREE.Color(bulbColors[bi % 4])); bi++; }
    }
  });
  bulbs.instanceMatrix.needsUpdate = true; if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
  world.add(bulbs);
  const wireGeo = keep(new THREE.BufferGeometry()); wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
  world.add(new THREE.Line(wireGeo, keep(new THREE.LineBasicMaterial({ color: 0x3a4660 }))));

  // Balls and music notes.
  const ttBall = ball(world, keep(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffa040, emissiveIntensity: 0.3 })), 0.05, TT.x, 1, TT.z); ttBall.visible = false;
  const beachTex = keep(canvasTexture(128, 64, (c) => { ['#ff5fa2', '#ffffff', '#ffd23f', '#ffffff', '#38c6f4', '#ffffff'].forEach((col, i) => { c.fillStyle = col; c.fillRect(i * (128 / 6), 0, 128 / 6 + 1, 64); }); }));
  const beach = ball(world, keep(new THREE.MeshStandardMaterial({ map: beachTex, roughness: 0.5 })), 0.3, 23.4, POOL.water + 0.25, -3);
  const noteSprite = (text: string, color: string) => {
    const t = keep(canvasTexture(128, 128, (c) => { c.fillStyle = color; c.font = '800 96px Inter, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 64, 64); }));
    const s = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }))); s.scale.set(0.55, 0.55, 1); s.visible = false; scene.add(s); return s;
  };
  const notes = [noteSprite('♪', '#b48cff'), noteSprite('♫', '#ff8a65'), noteSprite('♪', '#38f6a9'), noteSprite('♫', '#ffd23f')];

  // ─── Where the fun happens, in the order the spots fill ───
  const slot = (id: string, kind: Fun, zone: Slot['zone'], mode: PoseMode, x: number, z: number, y: number, face: number, node: string, pre: [number, number][], drift?: Slot['drift']): Slot =>
    ({ id, kind, zone, mode, x, z, y, face, node, pre, who: null, drift });
  const circle = (cx: number, cz: number, r: number, speed: number, ph: number): Slot['drift'] => (s) => {
    const a = reduce ? ph : s * speed + ph;
    return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a * 0.8) * r * 0.7, face: Math.sin(a * 0.5) * 0.8 + (cx < 23.5 ? 0.9 : -0.2) };
  };
  const laps: Slot['drift'] = (s) => {
    const span = POOL.z1 - POOL.z0 - 1.6, p = reduce ? 0.3 : (s * 0.09) % 2, f = p < 1 ? p : 2 - p;
    return { x: 26.5, z: POOL.z0 + 0.8 + span * f, face: p < 1 ? 0 : Math.PI };
  };
  const slots: Slot[] = [
    slot('ringA', 'ring', 'pool', 'ring', 22.0, -4.6, POOL.swimY, 0.9, 'p.w', [[18.2, -4.6]], circle(22.0, -4.6, 0.7, 0.22, 0)),
    slot('ringB', 'ring', 'pool', 'ring', 24.6, -1.3, POOL.swimY, -0.2, 'p.sw', [[24.6, 2.9]], circle(24.6, -1.3, 0.6, 0.19, 2)),
    slot('dance1', 'dance', 'pool', 'dance', 23.4, 5.2, 0, 0.6, 'p.sw', []),
    slot('ttA', 'tt', 'lounge', 'tt', TT.x - 1.95, TT.z, 0, HALF, 'l.1', [[3.3, -9.3]]),
    slot('ttB', 'tt', 'lounge', 'tt', TT.x + 1.95, TT.z, 0, -HALF, 'l.1', [[7.7, -9.3]]),
    slot('lounger1', 'lounger', 'pool', 'lounger', 20.6, -10.15, 0.26, 0, 'p.nw', [[19.5, -8.75], [19.7, -10.15]]),
    slot('dj', 'dj', 'pool', 'dance', 20.1, 5.9, 0, HALF, 'p.sw', []),
    slot('sofa1', 'sofa', 'lounge', 'sofa', 10.6, -12.62, 0.36, 0, 'l.2', [[9.3, -9.6], [9.3, -11.6], [10.6, -11.6]]),
    slot('laps', 'swim', 'pool', 'swim', 26.5, -2.6, POOL.swimY, 0, 'p.se', [[28.2, -2.6]], laps),
    slot('edge1', 'edge', 'pool', 'edge', 19.1, -6.2, -0.03, HALF, 'p.nw', [[18.4, -6.2]]),
    slot('chat1', 'chat', 'lounge', 'chat', -2.3, -11.6, 0, HALF, 'l.0', []),
    slot('chat2', 'chat', 'lounge', 'chat', -0.7, -11.6, 0, -HALF, 'l.0', []),
    slot('dance2', 'dance', 'pool', 'dance', 25.3, 6.6, 0, -0.5, 'p.sw', []),
    slot('lounger2', 'lounger', 'pool', 'lounger', 23.2, -10.15, 0.26, 0, 'p.nw', [[22.1, -8.75], [22.3, -10.15]]),
    slot('watch', 'watch', 'lounge', 'cheer', TT.x, TT.z + 1.7, 0, Math.PI, 'l.1', []),
    slot('sofa2', 'sofa', 'lounge', 'sofa', 12.6, -12.62, 0.36, 0, 'l.2', [[9.3, -9.6], [9.3, -11.6], [12.6, -11.6]]),
    slot('edge2', 'edge', 'pool', 'edge', 19.1, -2.4, -0.03, HALF, 'p.w', [[18.4, -2.4]]),
    slot('dance3', 'dance', 'pool', 'dance', 25.0, 4.4, 0, 0, 'p.sw', []),
    slot('lounger3', 'lounger', 'pool', 'lounger', 25.8, -10.15, 0.26, 0, 'p.ne', [[26.9, -8.75], [26.7, -10.15]]),
    slot('sofa3', 'sofa', 'lounge', 'sofa', 11.6, -12.62, 0.36, 0, 'l.2', [[9.3, -9.6], [9.3, -11.6], [11.6, -11.6]]),
  ];

  // ─── Walking routes: corridors as a small map of points and links ───
  const nodes = new Map<string, { x: number; z: number; adj: string[] }>();
  const addNode = (id: string, x: number, z: number) => { if (!nodes.has(id)) nodes.set(id, { x, z, adj: [] }); };
  const link = (a: string, b: string) => { const A = nodes.get(a)!, Bn = nodes.get(b)!; if (!A.adj.includes(b)) A.adj.push(b); if (!Bn.adj.includes(a)) Bn.adj.push(a); };
  addNode('cross', 0, 1.2); addNode('l.0', 0, -8.3); addNode('l.1', 5.5, -8.5); addNode('l.2', 11.4, -8.5);
  addNode('door.e', 14.4, 1.2); addNode('t.0', 16.5, 1.2); addNode('p.w', 18.2, 1.2); addNode('p.sw', 18.2, 2.9); addNode('p.nw', 18.2, -8.1);
  addNode('p.ne', 28.2, -8.1); addNode('p.se', 28.2, 2.9);
  addNode('m.out', -3.7, -8.65); addNode('m.in', -5.5, -8.65); addNode('m.se', -6.2, -8.2); addNode('m.sw', -13.6, -8.2); addNode('m.ne', -6.2, -12.75); addNode('m.nw', -13.6, -12.75);
  link('l.0', 'l.1'); link('l.1', 'l.2'); link('cross', 'door.e'); link('door.e', 't.0'); link('t.0', 'p.w'); link('p.w', 'p.sw'); link('p.w', 'p.nw');
  link('p.nw', 'p.ne'); link('p.ne', 'p.se'); link('p.sw', 'p.se');
  link('l.0', 'm.out'); link('m.out', 'm.in'); link('m.in', 'm.se'); link('m.se', 'm.sw'); link('m.se', 'm.ne'); link('m.ne', 'm.nw');
  /** The middle corridor: every aisle joins it. Call once the aisles are known. */
  const spine: string[] = ['cross', 'l.0'];
  const addAisle = (z: number) => { const id = `a.${z.toFixed(2)}`; if (!nodes.has(id)) { addNode(id, 0, z); spine.push(id); } return id; };
  const linkSpine = () => { spine.sort((a, b) => nodes.get(a)!.z - nodes.get(b)!.z); for (let i = 1; i < spine.length; i++) link(spine[i - 1], spine[i]); };
  const dist = (a: string, b: string) => Math.hypot(nodes.get(a)!.x - nodes.get(b)!.x, nodes.get(a)!.z - nodes.get(b)!.z);
  const route = (from: string, to: string): { x: number; z: number }[] => {
    const cost = new Map<string, number>([[from, 0]]), prev = new Map<string, string>(), open = new Set<string>([from]);
    while (open.size) {
      let cur = ''; let best = Infinity;
      for (const id of open) { const c = cost.get(id)!; if (c < best) { best = c; cur = id; } }
      if (cur === to) break;
      open.delete(cur);
      for (const n of nodes.get(cur)!.adj) { const c = best + dist(cur, n); if (c < (cost.get(n) ?? Infinity)) { cost.set(n, c); prev.set(n, cur); open.add(n); } }
    }
    const out: string[] = [to];
    while (out[0] !== from && prev.has(out[0])) out.unshift(prev.get(out[0])!);
    return out.map((id) => ({ x: nodes.get(id)!.x, z: nodes.get(id)!.z }));
  };
  const nearest = (x: number, z: number) => {
    let best = 'cross', d = Infinity;
    for (const [id, n] of nodes) { const k = Math.hypot(n.x - x, n.z - z); if (k < d) { d = k; best = id; } }
    return best;
  };
  const inPool = (x: number, z: number) => x > POOL.x0 + 0.15 && x < POOL.x1 - 0.15 && z > POOL.z0 + 0.15 && z < POOL.z1 - 0.15;

  // ─── Day and night ───
  let isDay = true;
  const setLight = (day: boolean, stop: boolean) => {
    isDay = day;
    const dim = stop ? 0.55 : 1;
    if (day) {
      hemi.color.set(stop ? 0xffd9d9 : 0xffffff); hemi.groundColor.set(0xb9c6dc); hemi.intensity = 1.55 * dim;
      sun.color.set(0xfff0d2); sun.intensity = 2.5 * dim; sun.position.set(-8, 34, 16);
      fill.color.set(0xffffff); fill.intensity = 0.32;
      lawnMat.color.set(0xcfe6bf); glassPane.color.set(0xcdeaff);
      lamps.forEach((x) => { x.l.intensity = 0; });
      shade.emissiveIntensity = 0.15; waterMat.emissiveIntensity = 0.12; danceMat.emissiveIntensity = 0.2;
    } else {
      hemi.color.set(stop ? 0xd09090 : 0x9fb6ff); hemi.groundColor.set(0x0b1430); hemi.intensity = 0.62 * dim;
      sun.color.set(0xc7d8ff); sun.intensity = 0.75 * dim; sun.position.set(-12, 30, 14);
      fill.color.set(0x4058a0); fill.intensity = 0.3;
      lawnMat.color.set(0x24384a); glassPane.color.set(0x1a2748);
      lamps.forEach((x) => { x.l.intensity = stop ? x.on * 0.25 : x.on; });
      shade.emissiveIntensity = 2.2; waterMat.emissiveIntensity = 0.9; danceMat.emissiveIntensity = stop ? 0.2 : 0.9;
    }
  };

  // ─── What moves by itself: water, balls, music, the party lights, the walls ───
  let danceStep = 0;
  const tick = (t: number, cam: THREE.Camera, s: { rally: boolean; dancing: boolean; stop: boolean; ringA: THREE.Vector3 | null; ringB: THREE.Vector3 | null }) => {
    sides.n.visible = cam.position.z > B.z0 + 0.5; sides.s.visible = cam.position.z < B.z1 - 0.5; sides.w.visible = cam.position.x > B.x0 + 0.5;
    drawClock();
    const sec = t / 1000;
    if (!reduce) { waterTex.offset.set(sec * 0.018, sec * 0.011); spare.position.set(21.0 + Math.sin(sec * 0.13) * 0.9, POOL.water + 0.05 + Math.sin(sec * 1.4) * 0.02, 0.5 + Math.cos(sec * 0.1) * 0.6); }
    // Table tennis: the ball flies only while both players are at the table.
    ttBall.visible = s.rally;
    let hitter = -1;
    if (s.rally) {
      const stroke = 900, n = Math.floor(t / stroke), f = (t % stroke) / stroke, dir = n % 2 === 0 ? 1 : -1;
      const x0 = TT.x - 1.5 * dir, x1 = TT.x + 1.5 * dir, xb = TT.x + 0.75 * dir, side = Math.sin(n * 1.7) * 0.3;
      if (f < 0.7) { const u = f / 0.7; ttBall.position.set(x0 + (xb - x0) * u, 1.12 + (0.83 - 1.12) * u + Math.sin(u * Math.PI) * 0.4, TT.z + side * u); }
      else { const u = (f - 0.7) / 0.3; ttBall.position.set(xb + (x1 - xb) * u, 0.83 + (1.12 - 0.83) * u + Math.sin(u * Math.PI) * 0.22, TT.z + side); }
      hitter = f > 0.85 ? (dir === 1 ? 1 : 0) : f < 0.12 ? (dir === 1 ? 0 : 1) : -1;
    }
    // Beach ball: thrown between the two floats when both are taken; otherwise it bobs on the water.
    let catcher = -1;
    if (s.ringA && s.ringB && !reduce && !s.stop) {
      const span = 2600, n = Math.floor(t / span), f = (t % span) / span, from = n % 2 === 0 ? s.ringA : s.ringB, to = n % 2 === 0 ? s.ringB : s.ringA;
      beach.position.set(from.x + (to.x - from.x) * f, POOL.water + 1.0 + Math.sin(f * Math.PI) * 1.7, from.z + (to.z - from.z) * f);
      beach.rotation.set(sec * 3, sec * 2, 0);
      catcher = f > 0.82 ? (n % 2 === 0 ? 1 : 0) : f < 0.15 ? (n % 2 === 0 ? 0 : 1) : -1;
    } else {
      beach.position.set(23.4 + Math.sin(sec * 0.17) * 0.8, POOL.water + 0.22 + (reduce ? 0 : Math.sin(sec * 1.6) * 0.03), -3.2 + Math.cos(sec * 0.13) * 0.9);
      beach.rotation.set(0.3, sec * 0.2, 0.2);
    }
    // Music at the DJ's desk.
    notes.forEach((nt, i) => {
      nt.visible = s.dancing && !reduce;
      if (!nt.visible) return;
      const p = (sec / 2.6 + i / notes.length) % 1;
      nt.position.set(20.9 + Math.sin(p * 6 + i) * 0.5, 1.9 + p * 1.8, i % 2 ? 4.3 : 7.5);
      (nt.material as THREE.SpriteMaterial).opacity = Math.sin(p * Math.PI);
    });
    const step = Math.floor(sec * 2);
    if (s.dancing && !reduce && step !== danceStep) { danceStep = step; drawDance(step); }
    disco.intensity = !isDay && s.dancing && !s.stop ? 14 + Math.sin(sec * 6) * 8 : 0;
    if (!isDay && s.dancing) disco.color.setHSL((sec * 0.15) % 1, 0.9, 0.6);
    return { hitter, catcher };
  };

  return { slots, seats, makeDesk, addAisle, linkSpine, route, nearest, inPool, setLight, tick, drawTv, P, flat, box, nodePos: (id: string) => nodes.get(id)! };
}
export type World = ReturnType<typeof buildWorld>;
