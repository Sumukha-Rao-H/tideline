import * as THREE from 'three';
import { backZ, sampleHeight, shoreZ } from '@/lib/terrainField';
import type { SceneCtx } from './types';

export interface Lighthouse {
  lz: number; // z of the lighthouse (hotspot anchor)
  beamPivot: THREE.Group;
  streakPivot: THREE.Group;
  beamMat: THREE.MeshBasicMaterial;
  streakMat: THREE.MeshBasicMaterial;
  lhLight: THREE.PointLight;
  lhSpot: THREE.SpotLight;
}

// ---- lighthouse (rocky base + tower) plus its beam — the hero moment.
// A slim additive cone sweeps a seaward arc from the lamp, with a matching
// streak on the water reading as its reflection, plus a real SpotLight. All
// fade in with the day cycle and are carried by the bloom pass.
export const createLighthouse = (ctx: SceneCtx): Lighthouse => {
  const { world, rng, addGlow } = ctx;
  const { rockMat, lampMat } = ctx.mats;

  // Sits on the headland just behind the beach, not out on the open sand.
  const lz = backZ(70) - 2;
  const lhBaseY = Math.max(sampleHeight(70, lz), 0.7);
  for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; const rr = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1 + rng() * 0.7, 0), rockMat); rr.position.set(70 + Math.cos(a) * 2.4, lhBaseY - 0.3, lz + Math.sin(a) * 2.4); rr.rotation.set(rng(), rng() * 3, rng()); rr.castShadow = true; world.add(rr); }
  const lh = new THREE.Group();
  const lhBody = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.5, 5.2, 14), new THREE.MeshStandardMaterial({ color: 0xf3efe8, roughness: 0.7 })); lhBody.position.y = 3.0; lhBody.castShadow = true;
  const lhBand = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 1.2, 1.1, 14), new THREE.MeshStandardMaterial({ color: 0xc94f3d, roughness: 0.7 })); lhBand.position.y = 3.1;
  const lhTop = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.95, 14), new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6 })); lhTop.position.y = 6.0;
  const lhLantern = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.95, 14), lampMat); lhLantern.position.y = 5.95;
  const lhCap = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.85, 14), new THREE.MeshStandardMaterial({ color: 0xc94f3d, roughness: 0.7 })); lhCap.position.y = 6.9;
  lh.add(lhBody, lhBand, lhTop, lhLantern, lhCap); lh.position.set(70, lhBaseY, lz); world.add(lh);
  addGlow(world, 70, lhBaseY + 5.9, lz, 0xffd58a, 7);
  const lhLight = new THREE.PointLight(0xffce8a, 0, 70); lhLight.position.set(70, lhBaseY + 6.3, lz); world.add(lhLight);

  // ---- beam ----
  const LANTERN_Y = lhBaseY + 5.95; // world height of the lantern
  const BEAM_LEN = 48;
  const beamGeo = new THREE.ConeGeometry(3.2, BEAM_LEN, 18, 1, true);
  beamGeo.translate(0, -BEAM_LEN / 2, 0); // apex at the pivot (the lamp)
  const beamColors = new Float32Array(beamGeo.attributes.position.count * 3);
  {
    const p = beamGeo.attributes.position.array as Float32Array;
    for (let i = 0; i < beamGeo.attributes.position.count; i++) {
      const t = Math.max(0, Math.min(1, 1 + p[i * 3 + 1] / BEAM_LEN)); // 1 at lamp → 0 at tip
      beamColors[i * 3] = 1.0 * t; beamColors[i * 3 + 1] = 0.82 * t; beamColors[i * 3 + 2] = 0.5 * t;
    }
  }
  beamGeo.setAttribute('color', new THREE.Float32BufferAttribute(beamColors, 3));
  beamGeo.rotateX(-Math.PI / 2 + 0.14); // swing to horizontal (+Z), tilt down onto the water
  const beamMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, side: THREE.DoubleSide });
  const beamPivot = new THREE.Group();
  beamPivot.position.set(70, LANTERN_Y, lz);
  beamPivot.add(new THREE.Mesh(beamGeo, beamMat));
  world.add(beamPivot);

  const streakGeo = new THREE.PlaneGeometry(3.0, 46, 1, 1);
  streakGeo.rotateX(-Math.PI / 2);
  streakGeo.translate(0, 0, 23); // runs +Z out from the lighthouse base
  const streakColors = new Float32Array(streakGeo.attributes.position.count * 3);
  {
    const p = streakGeo.attributes.position.array as Float32Array;
    for (let i = 0; i < streakGeo.attributes.position.count; i++) {
      const t = Math.max(0, Math.min(1, 1 - p[i * 3 + 2] / 46)); // bright at base → fades seaward
      streakColors[i * 3] = 1.0 * t; streakColors[i * 3 + 1] = 0.8 * t; streakColors[i * 3 + 2] = 0.46 * t;
    }
  }
  streakGeo.setAttribute('color', new THREE.Float32BufferAttribute(streakColors, 3));
  const streakMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, opacity: 0 });
  const streakPivot = new THREE.Group();
  streakPivot.position.set(70, 0.0, shoreZ(70)); // reflection sits on the open water in front of the headland
  streakPivot.add(new THREE.Mesh(streakGeo, streakMat));
  world.add(streakPivot);

  const lhSpot = new THREE.SpotLight(0xffd9a0, 0, 60, 0.15, 0.7, 1);
  const lhSpotTarget = new THREE.Object3D();
  lhSpotTarget.position.set(0, -6.5, 44); // out and down along the beam
  beamPivot.add(lhSpot, lhSpotTarget);
  lhSpot.target = lhSpotTarget;

  return { lz, beamPivot, streakPivot, beamMat, streakMat, lhLight, lhSpot };
};
