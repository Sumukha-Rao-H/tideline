import * as THREE from 'three';
import type { SceneRegistry, SharedMats } from './types';

// Materials used by more than one builder. The lamp and window materials are
// registered so the animate loop can drive their emissive intensity with the
// day cycle (promenade lamps + lighthouse lantern; building + house windows).
export const createSharedMats = (reg: SceneRegistry): SharedMats => {
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.8 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0xb89a6e, roughness: 1 });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8c8782, roughness: 1, flatShading: true });
  const roadMat = new THREE.MeshStandardMaterial({ color: 0xc7bca6, roughness: 1 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: new THREE.Color(0xffb74d), emissiveIntensity: 0 });
  reg.lampMats.push(lampMat);
  const winMat = new THREE.MeshStandardMaterial({ color: 0xfff0cf, emissive: new THREE.Color(0xffd27a), emissiveIntensity: 0 });
  reg.windowMats.push(winMat);
  return { postMat, deckMat, rockMat, roadMat, lampMat, winMat };
};
