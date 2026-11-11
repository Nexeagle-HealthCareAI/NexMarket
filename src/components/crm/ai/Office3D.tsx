'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Moon, Pause, Play, Presentation, RotateCcw, Sun, SunMoon, Waves } from 'lucide-react';
import type { ActionRow, AgentRow, Overview, Whereabouts } from './shared';
import { lookOf } from './shared';
import { mascotKit, type Mascot, type PoseMode } from './office3d/mascot';
import { buildWorld, canvasTexture, POOL, roundRect, type DeskParts, type Fun, type Seat, type Slot, type Spot } from './office3d/world';
import { AgentCard } from './office3d/AgentCard';

/**
 * The Vita marketing office in 3D: a real floor with desks, a glass meeting room, a lounge and a pool terrace. Each
 * agent is a Vita who walks the corridors on her own legs. Where she is always comes from the agent's real state:
 * at her desk when she is working (or switched off or paused, asleep there), in the meeting room for a hand-off or
 * when something is held for you, and at the pool party or in the lounge when there is no work. Tap any Vita to ask her.
 */

const WING_COLOR: Record<AgentRow['wing'], number> = { command: 0x01a0ec, leads: 0x38f6a9, studio: 0xb48cff, growth: 0xf5b544 };
const WING_AT: Record<AgentRow['wing'], { x: number; z: number }> = {
  command: { x: -7.6, z: -3.1 }, leads: { x: 7.6, z: -3.1 }, studio: { x: -7.6, z: 5.5 }, growth: { x: 7.6, z: 5.5 },
};
const WING_SIZE = { w: 12.4, d: 7.4 };
const TONE: Record<string, number> = { live: 0x38f6a9, shadow: 0x5cc8ff, wait: 0xf5b544, off: 0x8090ad };
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

const SAYINGS: Record<Fun, string[]> = {
  ring: ['splash!', 'catch!', 'wheee!', 'so cool!'],
  swim: ['lap 12!', 'phew!', 'one more!'],
  edge: ['nice water', 'ahh…', 'come in!'],
  lounger: ['sunny!', 'chill…', 'ahh…'],
  dance: ['♪ ♫', 'woohoo!', 'party!', '♫♪♫'],
  dj: ['one more!', '♪ ♫ ♪', 'hands up!'],
  tt: ['ping!', 'pong!', 'smash!', 'got it!'],
  watch: ['nice shot!', 'go go go!', 'wow!'],
  sofa: ['haha!', 'chai?', 'samosa?', 'hehe'],
  chat: ['no way!', 'haha!', 'so funny', 'really?'],
};
const DOING: Record<Fun, string> = {
  ring: 'floating in the pool', swim: 'swimming laps in the pool', edge: 'sitting by the pool with my feet in the water', lounger: 'resting on a sun lounger',
  dance: 'dancing at the pool party', dj: 'playing the music at the pool party', tt: 'playing table tennis in the lounge', watch: 'watching the table tennis',
  sofa: 'on the lounge sofa with a coffee', chat: 'chatting at the coffee bar',
};

interface Agent {
  id: string;
  name: string;
  m: Mascot;
  desk: DeskParts;
  tag: THREE.Sprite;
  dot: THREE.Sprite;
  tagKey: string;
  bubble: THREE.Sprite;
  bubbleUntil: number;
  nextBubble: number;
  zz: THREE.Sprite[];
  mail: THREE.Sprite;
  mailUntil: number;
  // Where she should be, from the agent's real state.
  deskBase: boolean;
  needsYou: boolean;
  workUntil: number;
  meetUntil: number;
  seat: Seat | null;
  slot: Slot | null;
  // Where she is.
  goal: string;
  target: Spot | null;
  path: { x: number; z: number }[];
  at: Spot | null;
  arrived: boolean;
  where: Whereabouts['place'];
  heading: number;
  // How she looks.
  anim: string;
  tone: string;
  sleepy: boolean;
  recent: boolean;
  guard: boolean;
  selected: boolean;
  waveUntil: number;
  screenOff: boolean;
  index: number;
}

function tagTexture(name: string, color: string, selected: boolean) {
  return canvasTexture(352, 72, (c) => {
    roundRect(c, 3, 3, 346, 66, 33);
    c.fillStyle = selected ? 'rgba(10,52,40,0.96)' : 'rgba(11,18,32,0.86)'; c.fill();
    c.lineWidth = selected ? 5 : 2; c.strokeStyle = selected ? '#38f6a9' : 'rgba(160,185,225,0.5)'; c.stroke();
    c.fillStyle = color; c.beginPath(); c.arc(34, 36, 11, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffffff'; c.font = '700 33px Inter, system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText(name, 56, 38, 280);
  });
}
function bubbleTexture(text: string) {
  return canvasTexture(256, 128, (c) => {
    roundRect(c, 8, 8, 240, 86, 30); c.fillStyle = '#ffffff'; c.fill();
    c.beginPath(); c.moveTo(112, 90); c.lineTo(128, 122); c.lineTo(146, 90); c.closePath(); c.fill();
    c.lineWidth = 4; c.strokeStyle = '#1b2a4a'; roundRect(c, 8, 8, 240, 86, 30); c.stroke();
    c.fillStyle = '#1b2a4a'; c.font = '800 40px Inter, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, 128, 52, 220);
  });
}
function textSprite(text: string, size: number, color: string) {
  const t = canvasTexture(128, 128, (c) => { c.fillStyle = color; c.font = `800 ${size}px Inter, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 64, 64); });
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
}

/** Day is 6 am to 6 pm in India (the hospital's time), whatever the viewer's own clock says. */
export function isDayInIndia(now = new Date()): boolean {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(now));
  return h >= 6 && h < 18;
}
type SkyMode = 'auto' | 'day' | 'night';
const SKY_KEY = 'vita.office.sky';

/** Desks inside a wing: up to three in a row. */
function deskSpots(n: number): { x: number; z: number }[] {
  const rows = Math.ceil(n / 3);
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / 3), inRow = r === rows - 1 ? n - r * 3 : 3, c = i % 3;
    out.push({ x: (c - (inRow - 1) / 2) * 3.6, z: (r - (rows - 1) / 2) * 3.5 + 0.5 });
  }
  return out;
}

export function webglOk(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

interface Api {
  update: (d: Overview, sel: string) => void;
  handoff: (from: string, to: string) => void;
  reset: () => void;
  lookAt: (place: 'pool' | 'meeting') => void;
  focus: (id: string | null) => void;
  setSpin: (on: boolean) => void;
  setSky: (day: boolean) => void;
  whereOf: (id: string) => Whereabouts;
}

export function Office3D({ data, selected, onPick, handoff, onFail, feed }: {
  data: Overview; selected: string; onPick: (id: string) => void; handoff: ActionRow | null; onFail: () => void; feed: ActionRow[];
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const api = useRef<Api | null>(null);
  const pickRef = useRef(onPick);
  const failRef = useRef(onFail);
  const openRef = useRef<(id: string) => void>(() => undefined);
  const [spin, setSpin] = useState(true);
  const [card, setCard] = useState<string | null>(null);
  const [whereabouts, setWhereabouts] = useState<Whereabouts>({ place: 'desk', doing: '' });
  const [skyMode, setSkyMode] = useState<SkyMode>(() => {
    try { const v = localStorage.getItem(SKY_KEY); return v === 'day' || v === 'night' ? v : 'auto'; } catch { return 'auto'; }
  });
  const [clockDay, setClockDay] = useState(() => isDayInIndia());
  const day = skyMode === 'auto' ? clockDay : skyMode === 'day';
  const lastHandoff = useRef<string | null>(null);

  useEffect(() => { pickRef.current = onPick; failRef.current = onFail; }, [onPick, onFail]);
  useEffect(() => { openRef.current = (id: string) => { setCard(id); setWhereabouts(api.current?.whereOf(id) ?? { place: 'desk', doing: '' }); }; }, []);

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
    renderer.domElement.setAttribute('aria-label', 'Vita marketing office in 3D. Drag to turn, scroll to zoom, tap a Vita to ask her what she is doing.');
    renderer.domElement.setAttribute('role', 'img');

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 260);
    const HOME_TARGET = new THREE.Vector3(7.5, 0, -1.5);
    // The whole office in view whatever the shape of the window: further back when it is narrow.
    const HOME_DIR = new THREE.Vector3(0.6, 0.62, 0.52).normalize();
    const homeAt = () => {
      const half = Math.tan((camera.fov * Math.PI) / 360);
      // On a phone the whole office would be too small to tap: start closer, and drag or use the buttons to move.
      return HOME_TARGET.clone().addScaledVector(HOME_DIR, Math.min(camera.aspect < 1 ? 60 : 82, Math.max(40, 25.5 / (half * camera.aspect))));
    };
    let touched = false;
    camera.position.copy(homeAt());
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 5;
    controls.maxDistance = 95;
    controls.maxPolarAngle = 1.3;
    controls.target.copy(HOME_TARGET);
    controls.autoRotate = !reduce;
    controls.autoRotateSpeed = 0.35;
    let spinWanted = !reduce;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let follow: string | null = null;
    let camGoal: THREE.Vector3 | null = null;
    controls.addEventListener('start', () => { touched = true; controls.autoRotate = false; camGoal = null; if (idleTimer) clearTimeout(idleTimer); });
    controls.addEventListener('end', () => { if (idleTimer) clearTimeout(idleTimer); idleTimer = setTimeout(() => { if (!follow) controls.autoRotate = spinWanted; }, 9000); });

    const disposables: { dispose: () => void }[] = [];
    const keep = <T extends { dispose: () => void }>(x: T) => { disposables.push(x); return x; };
    const world = buildWorld(scene, keep, reduce);
    const kit = mascotKit(keep);
    const dotTex = keep(canvasTexture(64, 64, (c) => {
      c.fillStyle = 'rgba(11,18,32,0.9)'; c.beginPath(); c.arc(32, 32, 30, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#ffffff'; c.beginPath(); c.arc(32, 32, 19, 0, Math.PI * 2); c.fill();
    }));
    const mailTex = keep(canvasTexture(128, 128, (c) => {
      roundRect(c, 14, 26, 100, 76, 14); c.fillStyle = '#01a0ec'; c.fill();
      c.strokeStyle = '#ffffff'; c.lineWidth = 8; c.beginPath(); c.moveTo(22, 36); c.lineTo(64, 70); c.lineTo(106, 36); c.stroke();
    }));

    // ─── Wings: a carpet in the wing's colour, its name on the floor, and a desk for every agent ───
    const wings = new Map<AgentRow['wing'], AgentRow[]>();
    for (const a of data.agents) wings.set(a.wing, [...(wings.get(a.wing) ?? []), a]);
    const agents = new Map<string, Agent>();
    let index = 0;
    for (const [wing, list] of wings) {
      const at = WING_AT[wing], color = WING_COLOR[wing];
      world.flat(scene, keep(new THREE.MeshStandardMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xc9ced8), 0.62), roughness: 1 })), WING_SIZE.w, WING_SIZE.d, at.x, 0.03, at.z);
      const name = list[0]?.wingName ?? wing;
      const sign = new THREE.Mesh(keep(new THREE.PlaneGeometry(5, 0.8)), keep(new THREE.MeshBasicMaterial({
        map: keep(canvasTexture(640, 104, (c) => { c.fillStyle = hex(new THREE.Color(color).lerp(new THREE.Color(0x10203a), 0.45).getHex()); c.font = '800 60px Inter, sans-serif'; c.textBaseline = 'middle'; c.fillText(name.toUpperCase(), 8, 54, 624); })),
        transparent: true, depthWrite: false,
      })));
      sign.rotation.x = -Math.PI / 2; sign.position.set(at.x - WING_SIZE.w / 2 + 2.8, 0.04, at.z + WING_SIZE.d / 2 - 0.55);
      scene.add(sign);

      const spots = deskSpots(list.length);
      list.forEach((a, i) => {
        const dx = at.x + spots[i].x, dz = at.z + spots[i].z, aisleZ = dz - 1.9;
        const desk = world.makeDesk(dx, dz, color, a.name, index, aisleZ, world.addAisle(aisleZ));
        desk.hit.userData.agent = a.id;
        const m = kit.make(color);
        m.root.position.set(desk.seat.x, desk.seat.y, desk.seat.z);
        m.hit.userData.agent = a.id;
        scene.add(m.root);
        const tag = new THREE.Sprite(keep(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false })));
        tag.center.set(0.5, 0); tag.position.set(0, 1.5, 0); tag.renderOrder = 20; m.root.add(tag);
        // On a phone, far away: just a dot in the status colour, so names don't cover the office.
        const dot = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: dotTex, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false })));
        dot.center.set(0.5, 0); dot.position.set(0, 1.5, 0); dot.renderOrder = 20; dot.visible = false; m.root.add(dot);
        const bubble = new THREE.Sprite(keep(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false })));
        bubble.center.set(0.5, 0); bubble.scale.set(1.7, 0.85, 1); bubble.position.set(0, 1.95, 0); bubble.renderOrder = 21; bubble.visible = false; m.root.add(bubble);
        const zz = [textSprite('z', 72, '#7f8fb0'), textSprite('Z', 90, '#7f8fb0')];
        zz.forEach((z) => { z.scale.set(0.42, 0.42, 1); z.visible = false; m.root.add(z); keep(z.material.map!); keep(z.material); });
        const mail = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: mailTex, transparent: true, depthWrite: false, depthTest: false })));
        mail.scale.set(0.6, 0.6, 1); mail.position.set(0, 2.1, 0); mail.renderOrder = 19; mail.visible = false; m.root.add(mail);
        agents.set(a.id, {
          id: a.id, name: a.name, m, desk, tag, dot, tagKey: '', bubble, bubbleUntil: 0, nextBubble: 3000 + Math.random() * 7000, zz, mail, mailUntil: 0,
          deskBase: true, needsYou: false, workUntil: 0, meetUntil: 0, seat: null, slot: null,
          goal: 'desk', target: desk.seat, path: [], at: desk.seat, arrived: true, where: 'desk', heading: 0,
          anim: 'none', tone: 'off', sleepy: false, recent: false, guard: a.id === 'compliance_guard', selected: false, waveUntil: 0, screenOff: false, index,
        });
        index += 1;
      });
    }
    world.linkSpine();
    const all = [...agents.values()];
    const slotsOf = (kind: Fun) => world.slots.filter((x) => x.kind === kind);
    const ringSlots = slotsOf('ring'), ttSlots = slotsOf('tt');

    const bubbleTex: Record<string, THREE.CanvasTexture> = {};
    const bubbleOf = (text: string) => (bubbleTex[text] ??= keep(bubbleTexture(text)));

    // ─── Who goes where ───
    let stopAll = false;
    let placed = false;
    let day = true;
    /** Agents keep their spot while they stay on a break, so nobody is shuffled around. */
    const seatBreaks = () => {
      for (const sl of world.slots) { const k = sl.who ? agents.get(sl.who) : null; if (!k || k.deskBase || k.slot !== sl) sl.who = null; }
      for (const k of all) if (k.slot && (k.slot.who !== k.id || k.deskBase)) k.slot = null;
      for (const k of all) {
        if (k.deskBase || k.slot) continue;
        const free = world.slots.find((x) => !x.who);
        if (!free) break;
        free.who = k.id; k.slot = free;
      }
    };
    const takeSeat = (k: Agent, prefer: number[]) => {
      if (k.seat) return;
      const order = [...prefer, ...world.seats.map((_, i) => i)];
      const i = order.find((n) => world.seats[n] && !world.seats[n].who);
      if (i === undefined) return;
      world.seats[i].who = k.id; k.seat = world.seats[i];
    };
    const leaveSeat = (k: Agent) => { if (k.seat) { k.seat.who = null; k.seat = null; } };
    const goalOf = (k: Agent, t: number): { key: string; spot: Spot } => {
      if (k.seat && (t < k.meetUntil || k.needsYou)) return { key: 'meet', spot: k.seat };
      if (k.deskBase || t < k.workUntil || !k.slot) return { key: 'desk', spot: k.desk.seat };
      return { key: k.slot.id, spot: k.slot };
    };
    const spotNow = (spot: Spot, t: number) => {
      const d = (spot as Slot).drift;
      return d ? d(t / 1000) : { x: spot.x, z: spot.z, face: spot.face };
    };
    /** The corridor route from where she is to a spot. */
    const plan = (k: Agent, spot: Spot) => {
      const pts: { x: number; z: number }[] = [];
      let from: string;
      if (k.at && k.arrived) { for (let i = k.at.pre.length - 1; i >= 0; i--) pts.push({ x: k.at.pre[i][0], z: k.at.pre[i][1] }); from = k.at.node; }
      else from = world.nearest(k.m.root.position.x, k.m.root.position.z);
      const way = world.route(from, spot.node);
      // Already past the first corner? Skip it rather than walking back.
      if (!(k.at && k.arrived) && way.length > 1) {
        const p = k.m.root.position, a = way[0], b = way[1];
        if (Math.hypot(b.x - p.x, b.z - p.z) < Math.hypot(b.x - a.x, b.z - a.z)) way.shift();
      }
      pts.push(...way);
      for (const p of spot.pre) pts.push({ x: p[0], z: p[1] });
      k.path = pts; k.target = spot; k.arrived = false; k.at = null;
    };
    const placeAt = (k: Agent, spot: Spot, key: string, t: number) => {
      const p = spotNow(spot, t);
      k.m.root.position.set(p.x, spot.y, p.z); k.heading = p.face; k.m.root.rotation.y = p.face;
      k.goal = key; k.target = spot; k.at = spot; k.arrived = true; k.path = [];
    };
    const placeOf = (k: Agent): Whereabouts['place'] => (!k.arrived ? 'walking' : k.goal === 'desk' ? 'desk' : k.goal === 'meet' ? 'meeting' : k.slot?.zone ?? 'lounge');
    const whereOf = (id: string): Whereabouts => {
      const k = agents.get(id);
      if (!k) return { place: 'desk', doing: '' };
      const place = placeOf(k);
      if (place === 'walking') return { place, doing: k.goal === 'desk' ? 'walking to my desk' : k.goal === 'meet' ? 'walking to the meeting room' : k.slot?.zone === 'pool' ? 'walking to the pool party' : 'walking to the lounge' };
      if (place === 'meeting') return { place, doing: k.needsYou ? 'waiting in the meeting room for your OK' : 'in the meeting room for a hand-off' };
      if (place === 'desk') return { place, doing: 'at my desk' };
      return { place, doing: k.slot ? DOING[k.slot.kind] : '' };
    };

    const retag = (k: Agent) => {
      const key = `${k.tone}|${k.selected}`;
      if (key === k.tagKey) return;
      k.tagKey = key;
      const mat = k.tag.material as THREE.SpriteMaterial;
      const old = mat.map;
      mat.map = tagTexture(k.name, hex(TONE[k.tone] ?? TONE.off), k.selected); mat.needsUpdate = true;
      old?.dispose();
      (k.dot.material as THREE.SpriteMaterial).color.setHex(TONE[k.tone] ?? TONE.off);
    };
    const update = (d: Overview, sel: string) => {
      stopAll = d.stopAll.on;
      world.setLight(day, stopAll);
      const now = performance.now();
      for (const a of d.agents) {
        const k = agents.get(a.id);
        if (!k) continue;
        const l = lookOf(a, d.stopAll.on);
        k.recent = !!a.last && Date.now() - new Date(a.last.created_at).getTime() < 5 * 60e3;
        // At the desk: the Guard (always on duty), anyone working right now, and anyone switched off or paused (asleep there).
        k.deskBase = k.guard || k.recent || a.paused || (a.available && a.mode === 'off');
        // Something of hers is held for a person to decide: she waits in the meeting room.
        k.needsYou = !d.stopAll.on && !k.guard && a.available && !a.paused && a.mode !== 'off' && a.last?.status === 'held';
        if (k.needsYou) takeSeat(k, [6, 0, 3]);
        else if (now >= k.meetUntil) leaveSeat(k);
        k.anim = l.anim; k.tone = l.tone; k.sleepy = l.zz;
        const col = TONE[l.tone] ?? TONE.off;
        const lm = k.desk.lamp.material as THREE.MeshStandardMaterial;
        lm.color.setHex(col); lm.emissive.setHex(col);
        (k.desk.halo.material as THREE.SpriteMaterial).color.setHex(col);
        k.selected = a.id === sel;
        retag(k);
      }
      seatBreaks();
      // First time: everyone starts where they belong, no parade across the office.
      if (!placed) {
        placed = true;
        for (const k of all) { const g = goalOf(k, now); placeAt(k, g.spot, g.key, now); }
      }
      // The meeting room screen shows today's real numbers.
      const lastLine = d.agents.filter((a) => a.last).sort((a, b) => (a.last!.created_at < b.last!.created_at ? 1 : -1))[0];
      world.drawTv(d.stopAll.on ? 'All agents stopped' : 'Vita marketing · today', [
        { label: 'Done', value: String(d.today.done), color: '#38f6a9' }, { label: 'Practice', value: String(d.today.shadow), color: '#5cc8ff' },
        { label: 'Stopped', value: String(d.today.blocked), color: '#f5b544' }, { label: 'Hand-offs', value: String(d.handoffsToday), color: '#b48cff' },
      ], lastLine?.last ? `${lastLine.name}: ${lastLine.last.summary}` : 'No actions yet today.');
    };
    const setSky = (isDay: boolean) => { day = isDay; world.setLight(day, stopAll); };

    // ─── Hand-offs: the two agents meet in the meeting room and the envelope changes hands ───
    const flights: { mesh: THREE.Sprite; from: THREE.Vector3; to: Agent; t0: number; dur: number; arc: number; then: () => void }[] = [];
    const meetings: { a: Agent; b: Agent; t0: number; passed: boolean; doneAt: number }[] = [];
    const sendMail = (from: Agent, to: Agent, arc: number, dur: number, then: () => void) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: mailTex, transparent: true, depthWrite: false, depthTest: false }));
      s.scale.set(0.7, 0.7, 1); s.renderOrder = 18; scene.add(s);
      flights.push({ mesh: s, from: from.m.root.position.clone().add(new THREE.Vector3(0, 1.6, 0)), to, t0: performance.now(), dur: reduce ? 1 : dur, arc, then });
    };
    const arrive = (k: Agent, t: number) => { k.mail.visible = true; k.mailUntil = t + 4000; k.workUntil = t + 30000; k.nextBubble = t + 30000; };
    const handoff = (from: string, to: string) => {
      const a = agents.get(from), b = agents.get(to);
      if (!a || !b || stopAll) return;
      const t = performance.now();
      // The Guard never leaves her desk, and without motion nobody walks: the envelope just flies across.
      if (reduce || a.guard || b.guard || meetings.some((m) => m.a === a || m.b === a || m.a === b || m.b === b)) { sendMail(a, b, 4, 2600, () => arrive(b, performance.now())); return; }
      takeSeat(a, [0, 1, 2]); takeSeat(b, [3, 4, 5]);
      if (!a.seat || !b.seat) { leaveSeat(a); leaveSeat(b); sendMail(a, b, 4, 2600, () => arrive(b, performance.now())); return; }
      a.meetUntil = b.meetUntil = t + 70000;
      meetings.push({ a, b, t0: t, passed: false, doneAt: 0 });
    };

    // Monitor: scrolling lines while working, dim otherwise.
    const drawScreen = (k: Agent, t: number, on: boolean) => {
      const c = k.desk.screenCtx;
      if (!on) {
        if (k.screenOff) return;
        k.screenOff = true;
        c.fillStyle = '#060c18'; c.fillRect(0, 0, 256, 144); c.fillStyle = '#121a2c'; c.fillRect(110, 64, 36, 16); k.desk.screenTex.needsUpdate = true;
        return;
      }
      k.screenOff = false;
      c.fillStyle = '#060c18'; c.fillRect(0, 0, 256, 144);
      const col = hex(TONE[k.tone] ?? TONE.off), busy = k.anim === 'bob' || k.anim === 'guard' || k.anim === 'tilt' || t < k.workUntil, speed = busy ? 22 : 5;
      for (let i = 0; i < 7; i++) {
        const y = ((i * 22 - (t / 1000) * speed) % 154 + 154) % 154 - 6;
        c.globalAlpha = 0.85; c.fillStyle = i % 3 === 0 ? col : '#9fdcff';
        c.fillRect(14, y, 40 + ((i * 53 + k.index * 37) % 150), 7);
      }
      c.globalAlpha = 1;
      k.desk.screenTex.needsUpdate = true;
    };

    // ─── Tapping ───
    const ray = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const hits: THREE.Object3D[] = all.flatMap((k) => [k.m.hit, k.desk.hit]);
    const targetTo = HOME_TARGET.clone();
    let flyTarget = false;
    let downAt: { x: number; y: number } | null = null;
    const pick = (ev: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      return ray.intersectObjects(hits, false)[0]?.object.userData.agent as string | undefined;
    };
    const focus = (id: string | null) => {
      follow = id;
      const k = id ? agents.get(id) : null;
      if (!k) return;
      touched = true; controls.autoRotate = false;
      k.waveUntil = performance.now() + 2400;
      // Come closer, keeping the direction we are looking from.
      const p = k.m.root.position;
      const dir = camera.position.clone().sub(controls.target); dir.y = Math.max(dir.y, dir.length() * 0.45); dir.normalize();
      targetTo.set(p.x, 0.8, p.z); camGoal = new THREE.Vector3(p.x, 0.8, p.z).addScaledVector(dir, 15); flyTarget = true;
    };
    const onDown = (ev: PointerEvent) => { downAt = { x: ev.clientX, y: ev.clientY }; };
    const onUp = (ev: PointerEvent) => {
      if (!downAt || Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 6) return;
      const id = pick(ev);
      if (!id) return;
      pickRef.current(id); focus(id); openRef.current(id);
    };
    let hovered: string | undefined;
    const onMove = (ev: PointerEvent) => {
      const id = pick(ev);
      if (id !== hovered) { hovered = id; renderer.domElement.style.cursor = id ? 'pointer' : 'grab'; }
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointermove', onMove);

    // Size and visibility: draw only while on screen and the tab is visible.
    let viewW = 1, viewH = 1, tagScale = 0.03;
    const resize = () => {
      viewW = Math.max(1, el.clientWidth); viewH = Math.max(1, el.clientHeight);
      renderer.setSize(viewW, viewH, false);
      renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
      camera.aspect = viewW / viewH;
      camera.fov = viewW < 640 ? 50 : 38;
      camera.updateProjectionMatrix();
      if (!touched) { const h = homeAt(); const turn = Math.atan2(camera.position.x - HOME_TARGET.x, camera.position.z - HOME_TARGET.z) - Math.atan2(HOME_DIR.x, HOME_DIR.z); camera.position.copy(h.sub(HOME_TARGET).applyAxisAngle(new THREE.Vector3(0, 1, 0), turn).add(HOME_TARGET)); }
      // Name tags keep the same size on screen however far the camera is (about 22 px tall).
      tagScale = ((viewW < 640 ? 19 : 22) / viewH) * 2 * Math.tan((camera.fov * Math.PI) / 360);
      // Easier to tap on a small screen.
      for (const k of all) k.m.hit.scale.set(viewW < 640 ? 1.8 : 1, 1, viewW < 640 ? 1.8 : 1);
    };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    let visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(el);

    const v = new THREE.Vector3();
    const turnTo = (from: number, to: number, f: number) => { let d = (to - from) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return from + d * f; };
    let raf = 0, lastT = 0, frame = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (!visible || document.hidden) return;
      frame += 1;
      const dt = Math.min(0.25, (t - (lastT || t)) / 1000); lastT = t;
      if (follow) { const k = agents.get(follow); if (k) { targetTo.set(k.m.root.position.x, 0.8, k.m.root.position.z); controls.target.lerp(targetTo, 0.08); } }
      if (flyTarget) {
        if (!follow) controls.target.lerp(targetTo, 0.08);
        if (camGoal) camera.position.lerp(camGoal, 0.06);
        if ((!camGoal || camera.position.distanceTo(camGoal) < 0.15) && controls.target.distanceTo(targetTo) < 0.08) { flyTarget = false; camGoal = null; }
      }
      controls.update();

      // Meetings: once both are seated the envelope changes hands, then the receiver goes to her desk with the work.
      for (let i = meetings.length - 1; i >= 0; i--) {
        const m = meetings[i];
        const seated = m.a.arrived && m.a.goal === 'meet' && m.b.arrived && m.b.goal === 'meet';
        if (!m.passed && (seated || t - m.t0 > 60000)) { m.passed = true; sendMail(m.a, m.b, 1.1, 1500, () => { m.b.mail.visible = true; m.b.mailUntil = performance.now() + 4000; m.doneAt = performance.now() + 2600; }); }
        if (m.passed && m.doneAt && t > m.doneAt) {
          m.a.meetUntil = 0; m.b.meetUntil = 0;
          if (!m.a.needsYou) leaveSeat(m.a);
          if (!m.b.needsYou) leaveSeat(m.b);
          m.b.workUntil = t + 30000; m.b.nextBubble = t + 30000;
          meetings.splice(i, 1);
        }
      }

      const ttPlayers = ttSlots.map((x) => (x.who ? agents.get(x.who) : null));
      const rally = !reduce && !stopAll && ttPlayers.every((k) => k && k.arrived && k.slot?.kind === 'tt' && k.goal === k.slot.id);
      const ringPos = ringSlots.map((x) => { const k = x.who ? agents.get(x.who) : null; return k && k.arrived && k.goal === x.id ? k.m.root.position : null; });
      const dancing = !stopAll && all.some((k) => k.arrived && k.slot && (k.slot.kind === 'dance' || k.slot.kind === 'dj') && k.goal === k.slot.id);
      const game = world.tick(t, camera, { rally, dancing, stop: stopAll, ringA: ringPos[0] ?? null, ringB: ringPos[1] ?? null });

      const tagBoxes: { x: number; y: number; w: number }[] = [];
      const order = all.map((k) => ({ k, d: camera.position.distanceToSquared(k.m.root.position) })).sort((a, b) => a.d - b.d);
      for (const { k } of order) {
        const root = k.m.root, s = t / 1000 + k.m.phase;
        // Where she should be now; a new place means a new route.
        if (!stopAll) {
          const g = goalOf(k, t);
          if (g.key !== k.goal || g.spot !== k.target) {
            k.goal = g.key;
            if (reduce) placeAt(k, g.spot, g.key, t); else plan(k, g.spot);
            k.nextBubble = t + 2500 + Math.random() * 5000;
          }
        }
        let mode: PoseMode = 'stand';
        let swing = false;
        if (!k.arrived && k.target) {
          const final = spotNow(k.target, t);
          const next = k.path[0] ?? final;
          const dx = next.x - root.position.x, dz = next.z - root.position.z, dist = Math.hypot(dx, dz);
          const wet = world.inPool(root.position.x, root.position.z);
          const step = (wet ? 1.5 : 2.5) * dt;
          if (dist <= Math.max(0.05, step)) {
            root.position.x = next.x; root.position.z = next.z;
            if (k.path.length) k.path.shift();
            else { k.arrived = true; k.at = k.target; }
          } else {
            root.position.x += (dx / dist) * step; root.position.z += (dz / dist) * step;
            k.heading = turnTo(k.heading, Math.atan2(dx, dz), Math.min(1, dt * 9));
          }
          const sitting = !k.path.length && dist < 0.7;
          const floorY = sitting ? k.target.y : wet ? POOL.swimY : 0;
          root.position.y += (floorY - root.position.y) * Math.min(1, dt * 9);
          mode = wet ? 'swim' : 'walk';
        }
        if (k.arrived && k.target) {
          const p = spotNow(k.target, t);
          root.position.x += (p.x - root.position.x) * Math.min(1, dt * 6); root.position.z += (p.z - root.position.z) * Math.min(1, dt * 6);
          root.position.y += (k.target.y - root.position.y) * Math.min(1, dt * 9);
          k.heading = turnTo(k.heading, p.face, Math.min(1, dt * 7));
          if (k.goal === 'desk') {
            const called = t < k.workUntil && !k.deskBase;
            mode = called || k.anim === 'bob' ? 'work' : k.guard ? 'guard' : k.sleepy ? 'sleep' : k.anim === 'tilt' ? 'think' : 'idle';
          } else if (k.goal === 'meet') mode = 'meet';
          else if (k.slot) {
            mode = k.slot.mode;
            if (k.slot.kind === 'tt') swing = game.hitter === ttPlayers.indexOf(k);
            if (k.slot.kind === 'ring') swing = game.catcher === ringSlots.indexOf(k.slot);
          }
        }
        root.rotation.y = k.heading;
        const frozen = stopAll || reduce;
        const asleep = stopAll && mode !== 'walk' && mode !== 'swim';
        kit.pose(k.m, asleep && (mode === 'work' || mode === 'think' || mode === 'idle' || mode === 'guard' || mode === 'meet') ? 'sleep' : mode, t,
          { reduce: frozen && mode !== 'walk' && mode !== 'swim', wave: t < k.waveUntil && k.arrived, swing, eyesClosed: asleep, fast: k.guard && k.anim === 'guard' });
        const place = placeOf(k);
        if (place !== k.where) k.where = place;

        // Name tag: the same size on screen at any zoom, lifted when it would cover another one.
        v.set(root.position.x, root.position.y + 1.45, root.position.z).project(camera);
        const compact = viewW < 640 && !k.selected && camera.position.distanceTo(root.position) > 34;
        k.dot.visible = compact && v.z < 1; k.dot.scale.set(tagScale * 0.7, tagScale * 0.7, 1);
        const sx = (v.x * 0.5 + 0.5) * viewW, sy = (-v.y * 0.5 + 0.5) * viewH, tw = (viewW < 640 ? 19 : 22) * (352 / 72);
        let level = 0;
        while (!compact && level < 4 && tagBoxes.some((b) => Math.abs(b.x - sx) < (b.w + tw) / 2 + 4 && Math.abs(b.y - (sy - level * 25)) < 24)) level += 1;
        if (!compact) tagBoxes.push({ x: sx, y: sy - level * 25, w: tw });
        k.tag.scale.set(tagScale * (352 / 72), tagScale, 1);
        k.tag.center.y = -level * 1.14;
        k.tag.visible = v.z < 1 && !compact;

        // Chatter while having fun.
        const fun = k.arrived && !!k.slot && k.goal === k.slot.id;
        if (fun && !stopAll && !reduce && t > k.nextBubble) {
          const say = SAYINGS[k.slot!.kind];
          const bm = k.bubble.material as THREE.SpriteMaterial;
          bm.map = bubbleOf(say[Math.floor(Math.random() * say.length)]); bm.needsUpdate = true;
          k.bubble.visible = true; k.bubbleUntil = t + 2000; k.nextBubble = t + 5000 + Math.random() * 9000;
        }
        if (k.bubble.visible) {
          const left = k.bubbleUntil - t;
          if (left <= 0 || !fun || stopAll) k.bubble.visible = false;
          else { const pop = Math.min(1, (2000 - left) / 160); k.bubble.scale.set(1.7 * pop, 0.85 * pop, 1); }
        }
        const sleeping = k.arrived && !reduce && (asleep || (k.goal === 'desk' && k.sleepy && t >= k.workUntil));
        k.zz.forEach((z, i) => {
          z.visible = sleeping;
          if (!sleeping) return;
          const p = (s * 0.45 + i * 0.5) % 1;
          z.position.set(0.4 + p * 0.45, 1.35 + p * 0.8, 0.2);
          (z.material as THREE.SpriteMaterial).opacity = Math.sin(p * Math.PI);
        });
        if (k.mail.visible && t > k.mailUntil) k.mail.visible = false;
        if (k.mail.visible) k.mail.position.y = 2.1 + Math.sin(t / 120) * 0.05;
        // Her desk: the status light breathes, the screen runs while she is there.
        const pulse = k.tone === 'live' || k.tone === 'shadow' ? 0.9 + Math.sin(s * 3.2) * 0.35 : 0.5;
        (k.desk.lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse * 1.6;
        k.desk.halo.scale.setScalar(0.5 + pulse * 0.35);
        (k.desk.halo.material as THREE.SpriteMaterial).opacity = 0.3 + pulse * 0.3;
        if ((frame + k.index) % 4 === 0) drawScreen(k, t, k.where === 'desk' && k.tone !== 'off' && !stopAll);
      }

      for (let i = flights.length - 1; i >= 0; i--) {
        const f = flights[i];
        const p = Math.min(1, (t - f.t0) / f.dur);
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        v.copy(f.to.m.root.position); v.y += 1.6;
        f.mesh.position.lerpVectors(f.from, v, e);
        f.mesh.position.y += Math.sin(e * Math.PI) * f.arc;
        f.mesh.material.rotation = Math.sin(t / 150) * 0.2;
        if (p >= 1) { scene.remove(f.mesh); f.mesh.material.dispose(); flights.splice(i, 1); f.then(); }
      }
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    const reset = () => {
      follow = null; touched = false;
      camGoal = homeAt(); targetTo.copy(HOME_TARGET); flyTarget = true;
      controls.autoRotate = spinWanted;
    };
    const setSpinFn = (on: boolean) => { spinWanted = on && !reduce; if (!follow) controls.autoRotate = spinWanted; };
    const lookAt = (place: 'pool' | 'meeting') => {
      follow = null; touched = true; controls.autoRotate = false; flyTarget = true;
      if (place === 'pool') { targetTo.set(23.2, 0, -2.2); camGoal = new THREE.Vector3(37, 15, 15); }
      else { targetTo.set(-9.6, 0.6, -10.2); camGoal = new THREE.Vector3(-1, 9.5, 2.5); }
    };
    api.current = { update, handoff, reset, lookAt, focus, setSpin: setSpinFn, setSky, whereOf };

    return () => {
      cancelAnimationFrame(raf);
      if (idleTimer) clearTimeout(idleTimer);
      ro.disconnect(); io.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointermove', onMove);
      controls.dispose();
      for (const k of all) (k.tag.material as THREE.SpriteMaterial).map?.dispose();
      flights.forEach((f) => f.mesh.material.dispose());
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
    };
    // The scene is built once for the agents that exist; later changes go through update().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.agents.length]);

  // Live state → the office; and sun or moon.
  useEffect(() => { api.current?.update(data, selected); }, [data, selected]);
  useEffect(() => { api.current?.setSky(day); }, [day, data.agents.length]);
  useEffect(() => {
    const t = setInterval(() => setClockDay(isDayInIndia()), 60000);
    return () => clearInterval(t);
  }, []);
  // While a card is open, keep "where she is" fresh (she may be walking).
  useEffect(() => {
    if (!card) return;
    const t = setInterval(() => {
      const w = api.current?.whereOf(card);
      if (w) setWhereabouts((cur) => (cur.place === w.place && cur.doing === w.doing ? cur : w));
    }, 800);
    return () => clearInterval(t);
  }, [card]);
  const nextSky = () => {
    const v: SkyMode = skyMode === 'auto' ? 'day' : skyMode === 'day' ? 'night' : 'auto';
    setSkyMode(v);
    try { localStorage.setItem(SKY_KEY, v); } catch { /* private mode */ }
  };
  const skyLabel = skyMode === 'auto' ? `Auto (${day ? 'day' : 'night'})` : day ? 'Day' : 'Night';
  // A new hand-off → the two agents meet.
  useEffect(() => {
    if (!handoff || !handoff.to_agent || handoff.id === lastHandoff.current) return;
    const first = lastHandoff.current === null;
    lastHandoff.current = handoff.id;
    if (!first || Date.now() - new Date(handoff.created_at).getTime() < 120000) api.current?.handoff(handoff.agent_id, handoff.to_agent);
  }, [handoff]);

  const cardAgent = card ? data.agents.find((a) => a.id === card) : undefined;
  const closeCard = () => { setCard(null); api.current?.focus(null); };

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
        <button type="button" onClick={() => { setCard(null); api.current?.lookAt('pool'); }} title="Look at the pool party"><Waves size={15} aria-hidden /><span>Pool party</span></button>
        <button type="button" onClick={() => { setCard(null); api.current?.lookAt('meeting'); }} title="Look at the meeting room"><Presentation size={15} aria-hidden /><span>Meeting room</span></button>
        <button type="button" onClick={() => { setCard(null); api.current?.reset(); }} title="Back to the whole office"><RotateCcw size={15} aria-hidden /><span>Whole office</span></button>
      </div>
      {cardAgent
        ? <AgentCard key={cardAgent.id} a={cardAgent} data={data} where={whereabouts} feed={feed} onClose={closeCard} />
        : <p className="ai-3d-hint">Tap any Vita to ask what she is doing · drag to turn · scroll or pinch to zoom</p>}
      {data.stopAll.on && <div className="ai-3d-stop">All agents stopped — nothing is sent</div>}
    </div>
  );
}
