import * as THREE from 'three';
import { nearRiver, sampleHeight, shoreZ } from '@/lib/terrainField';
import type { SceneCtx } from './types';

// ===================== BEACH PROPS (shacks, lifeguard towers, benches, umbrellas) =====================
export const createBeachProps = (ctx: SceneCtx) => {
  const { world, rng } = ctx;

  // Find a point on the dry sand at column x: walk inland from the waterline
  // until the sand has risen `rise` above the water, then sit on that height.
  const beachPoint = (x: number, rise: number) => {
    const sz = shoreZ(x);
    for (let d = 0; d < 34; d += 1) { const z = sz - d; const y = sampleHeight(x, z); if (y > rise) return new THREE.Vector3(x, y, z); }
    const z = sz - 8; return new THREE.Vector3(x, sampleHeight(x, z), z);
  };
  // Skip the marina pier (x≈-36), lighthouse point (x≈70) and the river delta
  // cutting across the sand (its centre wanders around x≈8–14 near the shore).
  const occupied = (x: number) => Math.abs(x + 36) < 9 || Math.abs(x - 70) < 8 || nearRiver(x, shoreZ(x) - 10);

  const mkLifeguard = (p: THREE.Vector3) => {
    const g = new THREE.Group();
    const legMat = new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 1 });
    const hutMat = new THREE.MeshStandardMaterial({ color: 0xe24b3a, roughness: 0.8 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ec, roughness: 0.85 });
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 2.4, 5), legMat); leg.position.set(lx * 0.95, 1.2, lz * 0.95); leg.castShadow = true; g.add(leg); }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.2, 2.7), trimMat); deck.position.y = 2.4; deck.castShadow = true; deck.receiveShadow = true; g.add(deck);
    const hut = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.5, 2.2), hutMat); hut.position.y = 3.25; hut.castShadow = true; g.add(hut);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.0, 0.8, 4), trimMat); roof.rotation.y = Math.PI / 4; roof.position.y = 4.4; roof.castShadow = true; g.add(roof);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.12, 3.0), legMat); ramp.position.set(0, 1.4, 2.0); ramp.rotation.x = 0.5; ramp.castShadow = true; g.add(ramp);
    g.position.copy(p); g.rotation.y = rng() * 0.4 - 0.2; world.add(g);
  };

  const mkShack = (p: THREE.Vector3, hue: number) => {
    const g = new THREE.Group();
    const wallMat = new THREE.MeshStandardMaterial({ color: hue, roughness: 0.85 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ec, roughness: 0.8 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.0, 2.6), wallMat); body.position.y = 1.0; body.castShadow = body.receiveShadow = true; g.add(body);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 2.5, 0.8, 4), roofMat); roof.rotation.y = Math.PI / 4; roof.position.y = 2.4; roof.castShadow = true; g.add(roof);
    const awn = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.1, 1.1), roofMat); awn.position.set(0, 1.7, 1.7); awn.rotation.x = -0.28; awn.castShadow = true; g.add(awn);
    for (const ax of [-1.4, 1.4]) { const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 5), wallMat); arm.position.set(ax, 1.35, 2.05); arm.rotation.x = Math.PI / 2.2; g.add(arm); }
    g.position.copy(p); g.rotation.y = rng() * 0.6 - 0.3; world.add(g);
  };

  const benchSeatMat = new THREE.MeshStandardMaterial({ color: 0x9c7b4f, roughness: 0.9 });
  const benchLegMat = new THREE.MeshStandardMaterial({ color: 0x394049, roughness: 0.7 });
  const mkBench = (p: THREE.Vector3) => {
    const g = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.55), benchSeatMat); seat.position.y = 0.5; seat.castShadow = true; g.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.1), benchSeatMat); back.position.set(0, 0.78, -0.22); back.castShadow = true; g.add(back);
    for (const lx of [-0.75, 0.75]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.5), benchLegMat); leg.position.set(lx, 0.25, 0); leg.castShadow = true; g.add(leg); }
    g.position.copy(p); g.rotation.y = Math.PI + (rng() * 0.4 - 0.2); world.add(g); // face the sea
  };

  const mkUmbrella = (p: THREE.Vector3, hue: number) => {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0xece7dd, roughness: 0.8 })); pole.position.y = 1.1; g.add(pole);
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.7, 10), new THREE.MeshStandardMaterial({ color: hue, roughness: 0.7, side: THREE.DoubleSide })); canopy.position.y = 2.3; canopy.castShadow = true; g.add(canopy);
    g.position.copy(p); g.rotation.y = rng() * Math.PI; g.rotation.z = (rng() - 0.5) * 0.18; world.add(g);
  };

  const umbHues = [0xe24b3a, 0xf4b65a, 0x3f8fb0, 0xe7e3da, 0xd98344, 0x6fae8e];
  const shackHues = [0xe7e3da, 0xf2d6a8, 0xcfe0e6, 0xe9c7b0];
  [-60, -8, 30, 86].forEach((x) => { if (!occupied(x)) mkLifeguard(beachPoint(x, 0.3)); });
  [-66, -20, 16, 52].forEach((x, i) => { if (!occupied(x)) mkShack(beachPoint(x, 0.9), shackHues[i % shackHues.length]); });
  for (let x = -70; x <= 90; x += 11) { if (!occupied(x)) mkBench(beachPoint(x, 0.6)); }
  for (let i = 0; i < 28; i++) { const x = -70 + rng() * 160; if (occupied(x)) continue; mkUmbrella(beachPoint(x, 0.2 + rng() * 0.6), umbHues[(rng() * umbHues.length) | 0]); }
};
