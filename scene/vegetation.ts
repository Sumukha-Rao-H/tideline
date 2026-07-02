import * as THREE from 'three';
import { nearRiver, oceanField, sampleHeight } from '@/lib/terrainField';
import type { SceneCtx } from './types';

// ---- trees (instanced conifers) + rocks (scattered inland) ----
// Placement uses the seeded ctx.rng, so the forest and rock scatter are the
// same on every load.
export const createVegetation = (ctx: SceneCtx) => {
  const { world, dummy, rng } = ctx;

  const treeSpots: Array<[number, number, number, number]> = [];
  for (let i = 0; i < 5200 && treeSpots.length < 950; i++) {
    const x = (rng() - 0.5) * 540, z = -150 + rng() * 330;
    const o = oceanField(x, z); if (o > -6) continue;
    const h = sampleHeight(x, z); if (h < 1.6 || h > 34) continue;
    const sl = Math.abs(sampleHeight(x + 2, z) - sampleHeight(x - 2, z)) + Math.abs(sampleHeight(x, z + 2) - sampleHeight(x, z - 2));
    if (sl > 5.5) continue;
    if (nearRiver(x, z)) continue;
    treeSpots.push([x, h, z, 0.8 + rng() * 1.15]);
  }
  const Nt = treeSpots.length;
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4f37, roughness: 1, flatShading: true });
  const pineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.22, 1, 5), trunkMat, Nt);
  const cone1 = new THREE.InstancedMesh(new THREE.ConeGeometry(1.05, 2.3, 7), pineMat, Nt);
  const cone2 = new THREE.InstancedMesh(new THREE.ConeGeometry(0.74, 1.8, 7), pineMat, Nt);
  trunks.castShadow = cone1.castShadow = cone2.castShadow = true;
  const greens = [0x4e7a3c, 0x3f6a34, 0x5d894a, 0x426f39, 0x6a9650];
  treeSpots.forEach((t, i) => {
    const [x, h, z, s] = t;
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(x, h + 0.5 * s, z); dummy.scale.set(s, s, s); dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, h + 1.55 * s, z); dummy.updateMatrix(); cone1.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, h + 2.65 * s, z); dummy.updateMatrix(); cone2.setMatrixAt(i, dummy.matrix);
    const g = new THREE.Color(greens[(rng() * greens.length) | 0]);
    cone1.setColorAt(i, g); cone2.setColorAt(i, g);
  });
  if (cone1.instanceColor) cone1.instanceColor.needsUpdate = true;
  if (cone2.instanceColor) cone2.instanceColor.needsUpdate = true;
  world.add(trunks, cone1, cone2);

  // ---- rocks (sparse, on inland slopes — the shore is sandy beach, not a
  // rocky edge; the lighthouse keeps its own rocky base) ----
  const rockSpots: Array<[number, number, number, number]> = [];
  for (let i = 0; i < 2600 && rockSpots.length < 150; i++) {
    const x = (rng() - 0.5) * 500, z = -70 + rng() * 250; const o = oceanField(x, z);
    if (nearRiver(x, z)) continue;
    if (o < -28) { const h = sampleHeight(x, z); if (h > 2 && h < 28 && rng() < 0.05) rockSpots.push([x, h, z, 0.4 + rng() * 0.9]); }
  }
  const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), ctx.mats.rockMat, rockSpots.length);
  rocks.castShadow = rocks.receiveShadow = true;
  rockSpots.forEach((r, i) => { const [x, h, z, s] = r; dummy.position.set(x, h + s * 0.15, z); dummy.scale.set(s * 1.3, s, s * 1.1); dummy.rotation.set(rng(), rng() * 3, rng()); dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix); });
  world.add(rocks);
};
