import * as THREE from 'three';
import { BEACH, fbm, hash, oceanField, sampleHeight } from '@/lib/terrainField';
import type { SceneCtx } from './types';

// ---- terrain mesh (snow-capped peaks, grass, sand, rock via vertex colour) ----
export const createTerrain = (ctx: SceneCtx) => {
  const SIZE = 920, SEG = 200;
  const tg = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG); tg.rotateX(-Math.PI / 2);
  const tpos = tg.attributes.position;
  for (let i = 0; i < tpos.count; i++) { tpos.setY(i, sampleHeight(tpos.getX(i), tpos.getZ(i))); }
  const tng = tg.toNonIndexed();
  const P = tng.attributes.position; const tcol = new Float32Array(P.count * 3);
  const cSand = new THREE.Color(0xd9c89c), cGrass = new THREE.Color(0x6f9a4e), cGrass2 = new THREE.Color(0x557c3b), cDry = new THREE.Color(0x9aa75a), cRock = new THREE.Color(0x8b8073), cRock2 = new THREE.Color(0x6f655a), cSnow = new THREE.Color(0xeef2f5);
  const tcCol = new THREE.Color();
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vCc = new THREE.Vector3(), vAB = new THREE.Vector3(), vAC = new THREE.Vector3(), vNrm = new THREE.Vector3();
  for (let i = 0; i < P.count; i += 3) {
    vA.set(P.getX(i), P.getY(i), P.getZ(i)); vB.set(P.getX(i + 1), P.getY(i + 1), P.getZ(i + 1)); vCc.set(P.getX(i + 2), P.getY(i + 2), P.getZ(i + 2));
    vAB.subVectors(vB, vA); vAC.subVectors(vCc, vA); vNrm.crossVectors(vAB, vAC).normalize();
    const ny = Math.abs(vNrm.y); const cy = (vA.y + vB.y + vCc.y) / 3, cx = (vA.x + vB.x + vCc.x) / 3, cz = (vA.z + vB.z + vCc.z) / 3;
    let c: THREE.Color;
    const oo = oceanField(cx, cz);
    if (oo > -BEACH || cy < 0.5) c = cSand; // the whole beach band + nearshore seabed reads as sand
    else if (cy > 56 && ny > 0.5) c = cSnow;
    else if (cy > 40) c = (ny > 0.62 ? cSnow.clone().lerp(cRock, 0.18) : (fbm(cx * 0.03, cz * 0.03, 3) > 0.5 ? cRock : cRock2));
    else if (cy > 26 || (ny < 0.5 && cy > 7)) c = (fbm(cx * 0.04, cz * 0.04, 3) > 0.45 ? cRock : cRock2);
    else { const n = fbm(cx * 0.012 + 7, cz * 0.012 + 2, 4); tcCol.copy(cGrass).lerp(cGrass2, n); if (n > 0.66) tcCol.lerp(cDry, 0.34); c = tcCol; }
    const j = (hash(i * 0.13, i * 0.37) - 0.5) * 0.05;
    const r = Math.min(1, Math.max(0, c.r + j)), g2 = Math.min(1, Math.max(0, c.g + j)), b2 = Math.min(1, Math.max(0, c.b + j));
    for (let k = 0; k < 3; k++) { tcol[(i + k) * 3] = r; tcol[(i + k) * 3 + 1] = g2; tcol[(i + k) * 3 + 2] = b2; }
  }
  tng.setAttribute('color', new THREE.BufferAttribute(tcol, 3));
  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 });
  const terrain = new THREE.Mesh(tng, terrainMat); terrain.receiveShadow = true; ctx.world.add(terrain);
  return terrain;
};
