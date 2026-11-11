import * as THREE from 'three';

/**
 * Vita in 3D: a small round eagle chick built from simple shapes (grey-blue feathers, cream belly with the mark, gold
 * beak and feet, teal wing tips, amber eyes). She has real legs and wings, so she can walk on the floor, sit at a desk,
 * type, sleep, dance, play and swim. Every agent is one Vita with a scarf in its wing's colour.
 */

export type Keep = <T extends { dispose: () => void }>(x: T) => T;

export type PoseMode =
  | 'stand' | 'walk' | 'work' | 'think' | 'sleep' | 'idle' | 'guard' | 'meet'
  | 'sofa' | 'lounger' | 'dance' | 'cheer' | 'tt' | 'ring' | 'swim' | 'edge' | 'chat';

export interface Mascot {
  root: THREE.Group;
  rig: THREE.Group;
  head: THREE.Group;
  eyes: THREE.Group;
  lids: THREE.Group;
  wingL: THREE.Group;
  wingR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  ring: THREE.Mesh;
  mug: THREE.Mesh;
  paddle: THREE.Group;
  hit: THREE.Mesh;
  phase: number;
  blinkAt: number;
}

export interface PoseOpts { reduce: boolean; wave?: boolean; swing?: boolean; eyesClosed?: boolean; fast?: boolean }

export function mascotKit(keep: Keep) {
  const std = (color: number, roughness = 0.88, metalness = 0) => keep(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  const M = {
    body: std(0x8a97ab), dark: std(0x66738b), face: std(0xb6bfcd), cream: std(0xf1e9d8), gold: std(0xdfa63c, 0.5, 0.15),
    teal: std(0x58c7cc), blue: std(0x5f8fd6), white: std(0xffffff, 0.3), amber: std(0xf0a030, 0.35), black: std(0x15171c, 0.3),
    brow: std(0x4c566c), mug: std(0xffffff, 0.4), red: std(0xe5484d, 0.6), wood: std(0xb98a55, 0.7),
    glint: keep(new THREE.MeshBasicMaterial({ color: 0xffffff })),
    hit: keep(new THREE.MeshBasicMaterial({ visible: false })),
    ringA: std(0xff6fa5, 0.45), ringB: std(0xffd23f, 0.45), ringC: std(0xff9f43, 0.45),
  };
  const G = {
    sphere: keep(new THREE.SphereGeometry(1, 20, 14)),
    cone: keep(new THREE.ConeGeometry(1, 1, 10)),
    cyl: keep(new THREE.CylinderGeometry(1, 1, 1, 12)),
    box: keep(new THREE.BoxGeometry(1, 1, 1)),
    torus: keep(new THREE.TorusGeometry(1, 0.2, 10, 24)),
    plane: keep(new THREE.PlaneGeometry(1, 1)),
    hit: keep(new THREE.CylinderGeometry(0.55, 0.55, 1.7, 8)),
  };
  // The mark on the belly.
  const logoCanvas = document.createElement('canvas');
  logoCanvas.width = 128; logoCanvas.height = 128;
  {
    const c = logoCanvas.getContext('2d')!;
    c.strokeStyle = '#2bb3c0'; c.lineWidth = 9; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(24, 34); c.lineTo(64, 62); c.lineTo(104, 34); c.stroke();
    c.strokeStyle = '#3d8fd8';
    c.beginPath(); c.moveTo(40, 56); c.lineTo(64, 78); c.lineTo(88, 56); c.stroke();
    c.beginPath(); c.moveTo(64, 20); c.lineTo(64, 44); c.stroke();
    c.fillStyle = '#2bb3c0'; c.font = '700 30px Inter, system-ui, sans-serif'; c.textAlign = 'center'; c.fillText('Vita', 64, 116);
  }
  const logoTex = keep(new THREE.CanvasTexture(logoCanvas)); logoTex.colorSpace = THREE.SRGBColorSpace;
  const logoMat = keep(new THREE.MeshBasicMaterial({ map: logoTex, transparent: true, depthWrite: false, toneMapped: false }));
  const scarf: Record<number, THREE.MeshStandardMaterial> = {};
  const rings = [M.ringA, M.ringB, M.ringC];

  type V3 = [number, number, number];
  const part = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, pos: V3, scale: V3 | number, rot?: V3, shadow = false) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    if (typeof scale === 'number') m.scale.setScalar(scale); else m.scale.set(...scale);
    if (rot) m.rotation.set(...rot);
    m.castShadow = shadow;
    parent.add(m);
    return m;
  };

  let made = 0;
  function make(scarfColor: number): Mascot {
    const root = new THREE.Group();
    const rig = new THREE.Group(); root.add(rig);
    // Body, belly, mark, tail.
    part(G.sphere, M.body, rig, [0, 0.52, 0], [0.36, 0.4, 0.34], undefined, true);
    part(G.sphere, M.cream, rig, [0, 0.48, 0.13], [0.27, 0.31, 0.24]);
    part(G.plane, logoMat, rig, [0, 0.5, 0.375], 0.26);
    part(G.cone, M.dark, rig, [-0.08, 0.3, -0.34], [0.07, 0.3, 0.03], [-2.0, 0, 0.25]);
    part(G.cone, M.blue, rig, [0, 0.29, -0.36], [0.07, 0.34, 0.03], [-2.0, 0, 0]);
    part(G.cone, M.dark, rig, [0.08, 0.3, -0.34], [0.07, 0.3, 0.03], [-2.0, 0, -0.25]);
    // Scarf in the wing's colour.
    scarf[scarfColor] ??= std(scarfColor, 0.8);
    part(G.torus, scarf[scarfColor], rig, [0, 0.83, 0.02], [0.25, 0.25, 0.3], [Math.PI / 2, 0, 0]);
    part(G.box, scarf[scarfColor], rig, [0.12, 0.72, 0.27], [0.09, 0.2, 0.03], [0.15, 0, -0.2]);

    // Head.
    const head = new THREE.Group(); head.position.set(0, 0.86, 0.03); rig.add(head);
    part(G.sphere, M.body, head, [0, 0.14, 0], 0.31, undefined, true);
    part(G.sphere, M.face, head, [0, 0.07, 0.2], [0.23, 0.17, 0.12]);
    for (const sx of [-1, 1]) part(G.sphere, M.body, head, [sx * 0.22, 0.04, 0.08], [0.13, 0.12, 0.13]);
    const eyes = new THREE.Group(); head.add(eyes);
    const lids = new THREE.Group(); lids.visible = false; head.add(lids);
    for (const sx of [-1, 1]) {
      part(G.sphere, M.white, eyes, [sx * 0.125, 0.17, 0.262], [0.085, 0.09, 0.05]);
      part(G.sphere, M.amber, eyes, [sx * 0.125, 0.17, 0.295], [0.06, 0.066, 0.03]);
      part(G.sphere, M.black, eyes, [sx * 0.125, 0.17, 0.317], [0.031, 0.037, 0.02]);
      part(G.sphere, M.glint, eyes, [sx * 0.125 + 0.022, 0.195, 0.333], 0.012);
      part(G.sphere, M.body, lids, [sx * 0.125, 0.17, 0.265], [0.09, 0.095, 0.055]);
      part(G.box, M.brow, lids, [sx * 0.125, 0.155, 0.318], [0.13, 0.02, 0.02], [0, 0, sx * -0.12]);
      part(G.box, M.brow, head, [sx * 0.125, 0.278, 0.262], [0.16, 0.034, 0.05], [0.2, 0, sx * 0.34]);
    }
    part(G.cone, M.gold, head, [0, 0.06, 0.33], [0.072, 0.17, 0.072], [Math.PI / 2 + 0.5, 0, 0]);
    // Crest feathers.
    const crest: [number, number, THREE.Material][] = [[-0.5, 0.2, M.dark], [-0.25, 0.25, M.body], [0, 0.29, M.face], [0.25, 0.25, M.body], [0.5, 0.2, M.dark]];
    crest.forEach(([rz, h, m]) => part(G.cone, m, head, [rz * 0.22, 0.42 + h * 0.25, -0.04], [0.055, h, 0.04], [-0.45, 0, -rz * 0.9]));

    // Wings (pivot at the shoulder) and legs (pivot at the hip).
    const wing = (sx: number) => {
      const g = new THREE.Group(); g.position.set(sx * 0.35, 0.72, 0); rig.add(g);
      part(G.sphere, M.dark, g, [0, -0.24, 0], [0.075, 0.27, 0.19], undefined, true);
      part(G.sphere, M.blue, g, [sx * 0.012, -0.37, -0.01], [0.07, 0.11, 0.175]);
      part(G.sphere, M.teal, g, [sx * 0.018, -0.46, -0.02], [0.062, 0.14, 0.15]);
      return g;
    };
    const wingL = wing(1), wingR = wing(-1);
    const leg = (sx: number) => {
      const g = new THREE.Group(); g.position.set(sx * 0.14, 0.2, 0.02); rig.add(g);
      part(G.cyl, M.gold, g, [0, -0.09, 0], [0.035, 0.2, 0.035]);
      part(G.sphere, M.gold, g, [0, -0.185, 0.05], [0.085, 0.03, 0.11], undefined, true);
      return g;
    };
    const legL = leg(1), legR = leg(-1);

    // Things she holds or wears in some places (hidden until needed).
    const ring = part(G.torus, rings[made % rings.length], rig, [0, 0.52, 0], [0.52, 0.52, 0.85], [Math.PI / 2, 0, 0]); ring.visible = false;
    const mug = part(G.cyl, M.mug, wingR, [0.05, -0.5, 0.1], [0.05, 0.1, 0.05]); mug.visible = false;
    const paddle = new THREE.Group(); paddle.position.set(0.02, -0.55, 0.06); paddle.visible = false; wingR.add(paddle);
    part(G.cyl, M.red, paddle, [0, -0.1, 0], [0.11, 0.02, 0.11], [0, 0, Math.PI / 2]);
    part(G.cyl, M.wood, paddle, [0, 0.04, 0], [0.018, 0.1, 0.018]);

    const hit = new THREE.Mesh(G.hit, M.hit); hit.position.y = 0.85; root.add(hit);
    made += 1;
    return { root, rig, head, eyes, lids, wingL, wingR, legL, legR, ring, mug, paddle, hit, phase: Math.random() * Math.PI * 2, blinkAt: 1500 + Math.random() * 3000 };
  }

  /** Sets every joint for this moment: one call per Vita per frame. */
  function pose(m: Mascot, mode: PoseMode, t: number, o: PoseOpts) {
    const s = t / 1000 + m.phase;
    const still = o.reduce;
    const sin = (f: number, a = 1, ph = 0) => (still ? 0 : Math.sin(s * f + ph) * a);
    const { rig, head, wingL, wingR, legL, legR } = m;
    rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); rig.scale.setScalar(1);
    head.rotation.set(0, 0, 0);
    wingL.rotation.set(0, 0, 0.16); wingR.rotation.set(0, 0, -0.16);
    legL.rotation.set(0, 0, 0); legR.rotation.set(0, 0, 0);
    m.ring.visible = false; m.mug.visible = false; m.paddle.visible = false;
    let closed = !!o.eyesClosed;
    const sit = () => { legL.rotation.x = -1.4; legR.rotation.x = -1.4; };

    switch (mode) {
      case 'walk': {
        const f = o.fast ? 11 : 8.5;
        legL.rotation.x = sin(f, 0.75); legR.rotation.x = -sin(f, 0.75);
        rig.position.y = still ? 0 : Math.abs(Math.sin(s * f)) * 0.04;
        rig.rotation.z = sin(f, 0.07);
        wingL.rotation.x = -sin(f, 0.4); wingR.rotation.x = sin(f, 0.4);
        head.rotation.z = -sin(f, 0.03);
        break;
      }
      case 'work':
        sit();
        wingL.rotation.set(-1.05 + sin(15, 0.13), 0, -0.05); wingR.rotation.set(-1.05 - sin(15, 0.13), 0, 0.05);
        head.rotation.set(0.14 + sin(1.3, 0.03), 0.3, 0);
        rig.position.y = sin(2.9, 0.008);
        break;
      case 'think':
        sit();
        wingR.rotation.set(-2.15, 0, 0.55);
        head.rotation.set(-0.08, 0.3 + sin(0.7, 0.12), 0.16 + sin(1.1, 0.04));
        break;
      case 'sleep':
        sit(); closed = true;
        head.rotation.set(0.42 + sin(1.5, 0.04), 0, 0.12);
        rig.scale.setScalar(1 + sin(1.5, 0.015));
        break;
      case 'idle':
        sit(); m.mug.visible = true;
        wingR.rotation.set(-1.2 - Math.max(0, sin(0.8)) * 0.9, 0, 0.25);
        head.rotation.set(0, sin(0.45, 0.45), 0);
        break;
      case 'guard':
        sit();
        head.rotation.set(0, sin(o.fast ? 3.2 : 1.1, 0.6), 0);
        wingL.rotation.set(-0.5, 0, -0.5); wingR.rotation.set(-0.5, 0, 0.5);
        break;
      case 'meet':
        sit();
        head.rotation.set(0, sin(0.6, 0.35), sin(1.7, 0.04));
        wingL.rotation.set(-0.7 - Math.max(0, sin(1.9)) * 0.6, 0, 0.2);
        wingR.rotation.set(-0.6, 0, -0.1);
        break;
      case 'sofa':
        sit(); m.mug.visible = true;
        rig.rotation.x = -0.16;
        wingR.rotation.set(-1.1 - Math.max(0, sin(0.7)) * 0.9, 0, 0.25);
        wingL.rotation.set(-0.3, 0, 0.5);
        head.rotation.set(0.05, sin(0.5, 0.5), 0);
        break;
      case 'lounger':
        rig.rotation.x = -0.85;
        legL.rotation.x = -0.75; legR.rotation.x = -0.75 + sin(0.9, 0.12);
        wingL.rotation.set(0.5, 0, 1.0); wingR.rotation.set(0.5, 0, -1.0);
        head.rotation.set(0.45, sin(0.35, 0.25), 0);
        closed = !still && Math.sin(s * 0.23) > 0.2;
        break;
      case 'dance':
        rig.position.y = still ? 0 : Math.abs(Math.sin(s * 6.5)) * 0.15;
        rig.rotation.y = sin(3.25, 0.55); rig.rotation.z = sin(6.5, 0.08);
        wingL.rotation.set(0, 0, 1.9 + sin(6.5, 0.45)); wingR.rotation.set(0, 0, -1.9 + sin(6.5, 0.45));
        legL.rotation.x = sin(6.5, 0.4); legR.rotation.x = -sin(6.5, 0.4);
        head.rotation.z = sin(3.25, 0.12);
        break;
      case 'cheer': {
        const j = still ? 0 : Math.max(0, Math.sin(s * 2.4));
        rig.position.y = j * j * 0.3;
        wingL.rotation.z = 0.3 + j * 2.0; wingR.rotation.z = -0.3 - j * 2.0;
        head.rotation.y = sin(1.2, 0.3);
        break;
      }
      case 'tt':
        m.paddle.visible = true;
        rig.position.y = still ? 0 : Math.abs(Math.sin(s * 3)) * 0.03;
        legL.rotation.x = 0.15; legR.rotation.x = -0.15;
        wingR.rotation.set(o.swing ? -1.9 : -0.9, 0, o.swing ? 0.5 : -0.3);
        wingL.rotation.set(-0.3, 0, 0.6);
        head.rotation.y = sin(3.5, 0.2);
        break;
      case 'ring':
        m.ring.visible = true;
        rig.position.y = sin(1.8, 0.03); rig.rotation.z = sin(1.3, 0.06); rig.rotation.x = sin(1.1, 0.04);
        wingL.rotation.set(0, 0, 1.15 + (o.swing ? 0.9 : 0)); wingR.rotation.set(0, 0, -1.15 - (o.swing ? 0.9 : 0));
        legL.rotation.x = sin(2.2, 0.4); legR.rotation.x = -sin(2.2, 0.4);
        head.rotation.y = sin(0.5, 0.35);
        break;
      case 'swim':
        rig.rotation.x = 0.75; rig.position.set(0, 0.1 + sin(3, 0.02), -0.15);
        wingL.rotation.set(sin(5, 1.2), 0, 1.1); wingR.rotation.set(-sin(5, 1.2), 0, -1.1);
        legL.rotation.x = 0.6 + sin(9, 0.4); legR.rotation.x = 0.6 - sin(9, 0.4);
        head.rotation.x = -0.6;
        break;
      case 'edge':
        legL.rotation.x = -1.0 + sin(2.4, 0.35); legR.rotation.x = -1.0 - sin(2.4, 0.35);
        wingL.rotation.set(0.5, 0, 0.5); wingR.rotation.set(0.5, 0, -0.5);
        rig.rotation.x = -0.1;
        head.rotation.set(0, sin(0.5, 0.5), sin(0.9, 0.05));
        break;
      case 'chat':
        m.mug.visible = true;
        wingR.rotation.set(-1.15 - Math.max(0, sin(0.6)) * 0.9, 0, 0.25);
        wingL.rotation.set(-0.4 - Math.max(0, sin(2.1)) * 0.5, 0, 0.3);
        head.rotation.set(sin(2.6, 0.06), sin(0.5, 0.2), 0);
        break;
      default:
        head.rotation.y = sin(0.5, 0.3);
        rig.scale.setScalar(1 + sin(1.6, 0.012));
    }
    // A wave hello when she is picked.
    if (o.wave) { wingL.rotation.set(0, 0, 2.5 + sin(12, 0.35)); head.rotation.z = 0.1; closed = false; }
    // Blinking.
    if (!still && !closed) {
      if (t > m.blinkAt + 140) m.blinkAt = t + 2200 + Math.random() * 3800;
      if (t > m.blinkAt) closed = true;
    }
    m.eyes.visible = !closed; m.lids.visible = closed;
  }

  return { make, pose };
}
