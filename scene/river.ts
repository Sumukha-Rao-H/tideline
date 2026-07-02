import * as THREE from 'three';
import {
  FALLS_BOT, FALLS_TOP, LAKE_CX, LAKE_CZ, LAKE_OUT, LAKE_Y, RIVER_SEA,
  backZ, lakeRad, riverCenterX, riverHalfW, sampleHeight, wlev,
} from '@/lib/terrainField';
import type { DayState } from '@/lib/dayCycle';
import type { SceneCtx } from './types';

export interface RiverWater {
  mesh: THREE.Mesh;
  base: Float32Array;
  amp: number;
  lit: boolean; // standard-material water needs its normals recomputed each frame
}

export interface River {
  riverWaters: RiverWater[];
  riverMats: THREE.MeshStandardMaterial[];
  riverTint: THREE.Color;
  flowTex: THREE.CanvasTexture;
  fallTex: THREE.CanvasTexture;
  spray: THREE.SpriteMaterial[];
  fallsAnchor: THREE.Vector3; // hotspot anchor over the waterfall/lake
}

// ---- Cascade Falls: river + waterfall + alpine lake + bridges ----
// The channel itself is carved out of the terrain in lib/terrainField; this
// builds the water surfaces that ride the unified wlev() profile — the
// mountain stream, the waterfall face, the lake disc and the outlet river —
// plus flow-streak overlays, waterfall foam, mist spray, the rocks ringing the
// lake, and the road bridges over the channel.
export const createRiver = (ctx: SceneCtx, cur: DayState): River => {
  const { world, rng } = ctx;
  const { deckMat, postMat, rockMat } = ctx.mats;

  const riverTint = new THREE.Color(0xdaf0f6);
  const riverWaters: RiverWater[] = [];
  const spray: THREE.SpriteMaterial[] = [];

  // flow-line texture (current streaks running along the channel)
  const mkFlowTex = (streaks: number, alpha: number, horiz: boolean) => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 256;
    const g = c.getContext('2d')!; g.clearRect(0, 0, 64, 256);
    for (let i = 0; i < streaks; i++) {
      g.strokeStyle = 'rgba(255,255,255,' + (alpha * (0.4 + rng() * 0.8)).toFixed(3) + ')';
      g.lineWidth = 0.6 + rng() * 2.2;
      g.beginPath();
      if (horiz) { const y = rng() * 256; for (let x = 0; x <= 64; x += 6) { g.lineTo(x, y + Math.sin(x * 0.18 + i) * 3); } }
      else { const x = rng() * 64; for (let y = 0; y <= 256; y += 8) { g.lineTo(x + Math.sin(y * 0.05 + i) * 3, y); } }
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  };
  const flowTex = mkFlowTex(11, 0.16, false);
  const fallTex = mkFlowTex(26, 0.5, true);

  // ribbon following the river centreline at the water level, with optional
  // skirt walls dropping from both edges so the water reads as a solid body
  const buildRibbon = (z0: number, z1: number, n: number, yOff: number, cross = 4, skirt = 0) => {
    const v: number[] = [], uv: number[] = [];
    const up = new THREE.Vector3(0, 1, 0), tan = new THREE.Vector3(), side = new THREE.Vector3();
    const ps: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) { const z = z0 + (z1 - z0) * i / n; ps.push(new THREE.Vector3(riverCenterX(z), wlev(z) + yOff, z)); }
    const sideV: THREE.Vector3[] = [], hwA: number[] = [];
    let acc = 0;
    for (let i = 0; i <= n; i++) {
      const p = ps[i], pa = ps[Math.max(0, i - 1)], pb = ps[Math.min(n, i + 1)];
      tan.subVectors(pb, pa); tan.y = 0; if (tan.lengthSq() < 1e-6) tan.set(0, 0, 1); tan.normalize();
      side.crossVectors(tan, up).normalize();
      const hw = riverHalfW(p.z);
      if (i > 0) acc += p.distanceTo(ps[i - 1]);
      sideV.push(side.clone()); hwA.push(hw);
      for (let c = 0; c <= cross; c++) { const f = (c / cross - 0.5) * 2; v.push(p.x + side.x * hw * f, p.y, p.z + side.z * hw * f); uv.push(c / cross, acc * 0.12); }
    }
    const row = cross + 1, idx: number[] = [];
    for (let i = 0; i < n; i++) for (let c = 0; c < cross; c++) { const a = i * row + c, b = a + row; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    if (skirt > 0) {
      const baseN = v.length / 3;
      for (let i = 0; i <= n; i++) {
        const p = ps[i], sd = sideV[i], hw = hwA[i];
        v.push(p.x - sd.x * hw, p.y - skirt, p.z - sd.z * hw); uv.push(0, 0);
        v.push(p.x + sd.x * hw, p.y - skirt, p.z + sd.z * hw); uv.push(1, 0);
      }
      for (let i = 0; i < n; i++) {
        const lt0 = i * row, lt1 = (i + 1) * row, rt0 = i * row + cross, rt1 = (i + 1) * row + cross;
        const lb0 = baseN + i * 2, lb1 = baseN + (i + 1) * 2, rb0 = lb0 + 1, rb1 = lb1 + 1;
        idx.push(lt0, lb0, lt1, lt1, lb0, lb1);   // left wall
        idx.push(rt0, rt1, rb0, rt1, rb1, rb0);   // right wall
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  };

  // animated water — same flat-shaded, faceted, rippling look as the ocean
  const riverMat = new THREE.MeshStandardMaterial({ color: cur.water.clone().lerp(riverTint, 0.12), roughness: 0.16, metalness: 0.4, transparent: true, opacity: 0.9, flatShading: true, side: THREE.DoubleSide });
  const flowMat = new THREE.MeshBasicMaterial({ map: flowTex, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending });
  const regWater = (mesh: THREE.Mesh, amp: number, lit: boolean) => {
    riverWaters.push({ mesh, base: (mesh.geometry.attributes.position.array as Float32Array).slice(), amp, lit });
    return mesh;
  };
  // river: mountain stream above the falls, and the outlet river fanning into
  // a delta at the sea
  const mkWater = (a: number, b: number, n: number) => { const rm = regWater(new THREE.Mesh(buildRibbon(a, b, n, 0, 5, 4), riverMat), 0.12, true); rm.receiveShadow = true; rm.renderOrder = 1; world.add(rm); };
  const mkFlow = (a: number, b: number, n: number) => { const fm = regWater(new THREE.Mesh(buildRibbon(a, b, n, 0.16, 5), flowMat), 0.12, false); fm.renderOrder = 2; world.add(fm); };
  mkWater(-150, FALLS_TOP, 90); mkFlow(-150, FALLS_TOP, 90);
  mkWater(LAKE_OUT, RIVER_SEA, 100); mkFlow(LAKE_OUT, 24, 40); // flow streaks kept off the open sea
  // waterfall water descending from stream level into the lake
  const fallWater = regWater(new THREE.Mesh(buildRibbon(FALLS_TOP, FALLS_BOT, 48, 0, 5, 3), riverMat), 0.1, true);
  fallWater.renderOrder = 1; world.add(fallWater);

  // lake — animated faceted water disc (polar grid) at the foot of the falls
  const lrings = 4, lseg = 56; const lv: number[] = [], li: number[] = [];
  for (let ri = 0; ri <= lrings; ri++) { const fr = ri / lrings; for (let si = 0; si <= lseg; si++) { const a = si / lseg * Math.PI * 2; const rad = lakeRad(a) * fr; lv.push(LAKE_CX + Math.cos(a) * rad, LAKE_Y + 0.12, LAKE_CZ + Math.sin(a) * rad / 0.92); } }
  const lrow = lseg + 1;
  for (let ri = 0; ri < lrings; ri++) for (let si = 0; si < lseg; si++) { const a = ri * lrow + si, b = a + lrow; li.push(a, b, a + 1, a + 1, b, b + 1); }
  // rim skirt: drop the outer ring straight down so the lake has body, not a
  // hollow underside
  {
    const outer = lrings * lrow, baseN = lv.length / 3;
    for (let si = 0; si <= lseg; si++) { const ix = (outer + si) * 3; lv.push(lv[ix], LAKE_Y - 5, lv[ix + 2]); }
    for (let si = 0; si < lseg; si++) { const t0 = outer + si, t1 = outer + si + 1, b0 = baseN + si, b1 = baseN + si + 1; li.push(t0, b0, t1, t1, b0, b1); }
  }
  const lakeGeo = new THREE.BufferGeometry();
  lakeGeo.setAttribute('position', new THREE.Float32BufferAttribute(lv, 3));
  lakeGeo.setIndex(li); lakeGeo.computeVertexNormals();
  const lake = regWater(new THREE.Mesh(lakeGeo, riverMat), 0.14, true);
  lake.receiveShadow = true; lake.renderOrder = 1; world.add(lake);

  // bright foam down the steep waterfall
  const fallMat = new THREE.MeshBasicMaterial({ map: fallTex, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
  const fall = new THREE.Mesh(buildRibbon(FALLS_TOP, FALLS_BOT, 48, 0.25), fallMat);
  fall.renderOrder = 3; world.add(fall);

  // mist / spray at the foot of the falls
  const sprayTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const fbX = riverCenterX(FALLS_BOT), fbY = LAKE_Y + 1.4;
  for (let i = 0; i < 5; i++) {
    const m = new THREE.SpriteMaterial({ map: sprayTex, color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
    const s = new THREE.Sprite(m); s.scale.set(6 + i * 1.4, 5 + i, 1);
    s.position.set(fbX + (i - 2) * 2.0, fbY + rng() * 1.6, FALLS_BOT + rng() * 3);
    world.add(s); spray.push(m);
  }

  // rocks ringing the lake shore (kept just outside the waterline) + boulders
  // flanking the falls
  for (let i = 0; i < 40; i++) {
    const a = rng() * Math.PI * 2, rad = lakeRad(a) * (1.04 + rng() * 0.22);
    const x = LAKE_CX + Math.cos(a) * rad, z = LAKE_CZ + Math.sin(a) * rad / 0.92;
    const h = sampleHeight(x, z); const s = 0.8 + rng() * 2.2;
    const rk = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), rockMat);
    rk.position.set(x, h + s * 0.1, z); rk.scale.set(s * 1.2, s, s * 1.1);
    rk.rotation.set(rng(), rng() * 3, rng()); rk.castShadow = rk.receiveShadow = true; world.add(rk);
  }
  for (let i = 0; i < 14; i++) {
    const z = FALLS_TOP + rng() * (FALLS_BOT - FALLS_TOP);
    const side = rng() < 0.5 ? -1 : 1;
    const cx = riverCenterX(z) + side * (riverHalfW(z) + 0.6 + rng() * 2.6);
    const h = sampleHeight(cx, z); const s = 0.6 + rng() * 1.5;
    const rk = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), rockMat);
    rk.position.set(cx, h + s * 0.1, z); rk.scale.set(s, s, s);
    rk.rotation.set(rng(), rng() * 3, rng()); rk.castShadow = true; world.add(rk);
  }

  // bridges where the two shore roads cross the river (offsets match the
  // coast/inland roads in scene/structures.ts)
  const mkBox = (w: number, h: number, dd: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; world.add(m); return m;
  };
  const mkBridge = (roadOff: number) => {
    for (let x = -74; x <= 86; x += 0.5) {
      const z = backZ(x) - roadOff;
      if (Math.abs(x - riverCenterX(z)) < 1.0) {
        const cx = riverCenterX(z); const span = riverHalfW(z) * 2 + 5;
        const by = Math.max(sampleHeight(cx - span / 2, z), sampleHeight(cx + span / 2, z), 0.6) + 0.8;
        mkBox(span, 0.35, 3.4, cx, by, z, deckMat);
        for (const s of [-1, 1]) { mkBox(span, 0.5, 0.16, cx, by + 0.45, z + s * 1.5, postMat); }
        break;
      }
    }
  };
  mkBridge(4); mkBridge(20);

  return {
    riverWaters, riverMats: [riverMat], riverTint, flowTex, fallTex, spray,
    fallsAnchor: new THREE.Vector3(LAKE_CX, LAKE_Y + 8, FALLS_BOT),
  };
};
