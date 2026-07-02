import * as THREE from 'three';
import { backZ, sampleHeight, shoreZ } from '@/lib/terrainField';
import type { SceneCtx } from './types';

export interface Structures {
  pz: number; // shoreline z at the marina pier column
  grove: { gx: number; gy: number; gz: number }; // pavilion anchor
}

// Promenade + lamps, marina + boats, pavilion, white buildings, roads and the
// seaside houses — everything built, everything anchored behind the beach.
export const createStructures = (ctx: SceneCtx): Structures => {
  const { world, rng, addGlow } = ctx;
  const { postMat, deckMat, roadMat, lampMat, winMat } = ctx.mats;

  const mkBox = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; world.add(m); return m;
  };

  // ---- promenade + lamps ----
  const shorePts: THREE.Vector3[] = [];
  for (let x = -78; x <= 96; x += 8) { const z = shoreZ(x); const y = Math.max(sampleHeight(x, z - 5), 0.5); shorePts.push(new THREE.Vector3(x, y + 0.2, z - 5)); }
  const promCurve = new THREE.CatmullRomCurve3(shorePts);
  const promGeo = new THREE.TubeGeometry(promCurve, 140, 1.7, 4, false);
  const prom = new THREE.Mesh(promGeo, new THREE.MeshStandardMaterial({ color: 0xcdbd97, roughness: 1 }));
  prom.scale.set(1, 0.09, 1); prom.receiveShadow = true; world.add(prom);
  for (let i = 0; i <= 18; i++) {
    const p = promCurve.getPoint(i / 18);
    const grp = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.0, 6), postMat); post.position.y = 1.0; post.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), lampMat); head.position.y = 2.05;
    grp.add(post, head); grp.position.set(p.x, p.y, p.z); world.add(grp);
    addGlow(world, p.x, p.y + 2.05, p.z, 0xffc266, 2.6);
  }

  // ---- marina (pier + pilings + boats) ----
  const pz = shoreZ(-36);
  const pierY = 1.5;
  mkBox(3.4, 0.34, 32, -36, pierY, pz + 8, deckMat);
  for (let i = 0; i < 3; i++) { mkBox(7, 0.26, 1.2, -40, pierY, pz + 8 + i * 5, deckMat); }
  const pileMat = new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 1 });
  for (let i = 0; i < 7; i++) { const zz = pz + i * 4; for (const xx of [-37.5, -34.5]) { const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 4.4, 6), pileMat); pile.position.set(xx, pierY - 2.1, zz); pile.castShadow = true; world.add(pile); } }
  const mkBoat = (x: number, z: number, c: number, scl: number, rot: number) => {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 3.0), new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 })); hull.castShadow = true;
    const bow = new THREE.Mesh(new THREE.ConeGeometry(0.65, 1.2, 4), new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
    bow.rotation.x = Math.PI / 2; bow.rotation.y = Math.PI / 4; bow.position.z = 1.9; bow.scale.set(1, 0.42, 1); bow.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 1.1), new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.5 })); cabin.position.set(0, 0.45, -0.2); cabin.castShadow = true;
    g.add(hull, bow, cabin); g.scale.setScalar(scl); g.position.set(x, 0.7, z); g.rotation.y = rot || 0; world.add(g); return g;
  };
  mkBoat(-43, pz + 6, 0xf4f4f2, 0.95, 0); mkBoat(-43, pz + 11, 0xeae6dd, 0.9, 0); mkBoat(-43, pz + 16, 0xf4f4f2, 1.0, 0);
  mkBoat(-30, pz + 9, 0xe8e4da, 0.85, 0.1);
  ctx.reg.movingBoats.push({ m: mkBoat(0, pz + 40, 0xf2f2f0, 1.1, 0), cx: -6, cz: pz + 44, rx: 34, rz: 14, sp: 0.05, ph: 0 });
  ctx.reg.movingBoats.push({ m: mkBoat(40, pz + 20, 0xeae6dd, 0.95, 0), cx: 30, cz: pz + 26, rx: 22, rz: 11, sp: -0.04, ph: 2.2 });

  // ---- pavilion (gazebo) ----
  const gx = -52, gz = 14, gy = sampleHeight(gx, gz);
  const pav = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.7, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0xb89a6e, roughness: 1 })); deck.position.y = 0.15; deck.receiveShadow = true; pav.add(deck);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.1, 6), postMat); post.position.set(Math.cos(a) * 2.2, 1.2, Math.sin(a) * 2.2); post.castShadow = true; pav.add(post); }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.3, 1.6, 6), new THREE.MeshStandardMaterial({ color: 0xc25245, roughness: 0.8 })); roof.position.y = 3.0; roof.castShadow = true; pav.add(roof);
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshStandardMaterial({ color: 0xf4b65a })); finial.position.y = 3.9; pav.add(finial);
  pav.position.set(gx, gy, gz); world.add(pav);

  // ---- white buildings cluster ----
  const bSpots: Array<[number, number]> = [[96, -6], [103, -13], [92, -16], [108, -4], [99, -22]];
  bSpots.forEach((b, i) => {
    const x = b[0];
    const z = backZ(x) - 7 - i * 3; // step the cluster back behind the beach
    const gh = sampleHeight(x, z); const hh = 7 + rng() * 9, w = 2.2 + rng() * 1.4;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, w), new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.85 }));
    m.position.set(x, gh + hh / 2, z); m.castShadow = true; m.receiveShadow = true; world.add(m);
    const win = new THREE.Mesh(new THREE.BoxGeometry(w * 0.72, hh * 0.78, w * 0.72), winMat); win.position.set(x, gh + hh / 2, z); world.add(win);
    addGlow(world, x, gh + hh * 0.6, z + w * 0.5, 0xffcf8a, 2.2);
  });

  // ---- residential roads (draped ribbons) ----
  const mkRoad = (anchorPts: Array<[number, number]>, width: number) => {
    const base = new THREE.CatmullRomCurve3(anchorPts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    const n = Math.max(28, anchorPts.length * 10);
    const verts: number[] = [], idx: number[] = [];
    const up = new THREE.Vector3(0, 1, 0), tan = new THREE.Vector3(), side = new THREE.Vector3();
    for (let i = 0; i <= n; i++) {
      const t = i / n; const p = base.getPoint(t); base.getTangent(t, tan); tan.y = 0; tan.normalize();
      side.crossVectors(tan, up).normalize().multiplyScalar(width * 0.5);
      const yL = Math.max(sampleHeight(p.x - side.x, p.z - side.z), 0.35) + 0.45;
      const yR = Math.max(sampleHeight(p.x + side.x, p.z + side.z), 0.35) + 0.45;
      verts.push(p.x - side.x, yL, p.z - side.z, p.x + side.x, yR, p.z + side.z);
      if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, roadMat); m.receiveShadow = true; world.add(m);
  };
  const coastWp: Array<[number, number]> = [], inlandWp: Array<[number, number]> = [];
  for (let x = -74; x <= 86; x += 8) { const b = backZ(x); coastWp.push([x, b - 4]); inlandWp.push([x, b - 20]); }
  mkRoad(coastWp, 3.0);
  mkRoad(inlandWp, 2.6);
  const crossX = [-56, -22, 12, 44, 74];
  crossX.forEach((x) => { const b = backZ(x); mkRoad([[x, b - 2], [x + 1, b - 16], [x + 2, b - 30]], 2.0); });

  // ---- houses (seaside residential) ----
  const housePal = [0xede6d6, 0xf2ddc6, 0xe6c9a8, 0xd2dbd4, 0xe9e3d1, 0xdcc9b0, 0xcdb79c];
  const roofPal = [0xb5503f, 0xc25245, 0x8a5a44, 0x6f7d74, 0x9a6b4f, 0x566a64, 0x7a4a3a];
  const mkHouse = (x: number, hgy: number, z: number, rot: number) => {
    const g = new THREE.Group();
    const bw = 2.2 + rng() * 1.5, bd = 2.0 + rng() * 1.3, bh = 1.6 + rng() * 1.0;
    const body = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), new THREE.MeshStandardMaterial({ color: housePal[(rng() * housePal.length) | 0], roughness: 0.9 }));
    body.position.y = bh / 2; body.castShadow = body.receiveShadow = true; g.add(body);
    const rh = 1.0 + rng() * 0.6;
    const hroof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(bw, bd) * 0.8, rh, 4), new THREE.MeshStandardMaterial({ color: roofPal[(rng() * roofPal.length) | 0], roughness: 0.85, flatShading: true }));
    hroof.rotation.y = Math.PI / 4; hroof.scale.set(bw / Math.max(bw, bd), 1, bd / Math.max(bw, bd)); hroof.position.y = bh + rh / 2; hroof.castShadow = true; g.add(hroof);
    const win = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.66, bh * 0.55, bd * 0.66), winMat); win.position.y = bh * 0.5; g.add(win);
    g.position.set(x, hgy - 0.15, z); g.rotation.y = rot; world.add(g);
    addGlow(world, x, hgy + bh * 0.55, z, 0xffd49a, 1.5);
  };
  const onRoad = (x: number, z: number, bz: number) => {
    if (Math.abs(z - (bz - 4)) < 3.4) return true;    // coast road (just behind beach)
    if (Math.abs(z - (bz - 20)) < 3.4) return true;   // inland road
    for (const c of crossX) { const cb = backZ(c); if (z > cb - 32 && z < cb && Math.abs(x - (c + 1)) < 3.4) return true; }
    return false;
  };
  const houseSpots: Array<[number, number, number]> = [];
  for (let i = 0; i < 9000 && houseSpots.length < 50; i++) {
    const x = -76 + rng() * 166;
    const bz = backZ(x);
    const z = bz - 3 - rng() * 38; // behind the beach, spread inland
    const h = sampleHeight(x, z); if (h < 1.4 || h > 17) continue;
    const sl = Math.abs(sampleHeight(x + 2, z) - sampleHeight(x - 2, z)) + Math.abs(sampleHeight(x, z + 2) - sampleHeight(x, z - 2));
    if (sl > 4.5) continue;
    if (onRoad(x, z, bz)) continue;
    if (houseSpots.some((s) => Math.hypot(s[0] - x, s[1] - z) < 8.2)) continue;
    houseSpots.push([x, z, h]);
  }
  houseSpots.forEach(([x, z, h]) => mkHouse(x, h, z, (rng() - 0.5) * 0.5));

  return { pz, grove: { gx, gy, gz } };
};
