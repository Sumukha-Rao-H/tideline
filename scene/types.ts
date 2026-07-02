import * as THREE from 'three';
import type { Rng } from '@/lib/rng';

export interface MovingBoat {
  m: THREE.Group;
  cx: number;
  cz: number;
  rx: number;
  rz: number;
  sp: number;
  ph: number;
}

export interface CamTween {
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  t: number;
  dur: number;
  onDone?: () => void;
}

// Mutable collections the animate loop drives every frame; builders push into
// them as they create glow sprites, emissive materials and moving boats.
export interface SceneRegistry {
  glowSprites: THREE.SpriteMaterial[];
  lampMats: THREE.MeshStandardMaterial[];
  windowMats: THREE.MeshStandardMaterial[];
  movingBoats: MovingBoat[];
}

// Materials shared across builders (the lighthouse lantern reuses the
// promenade lamp material; houses reuse the buildings' window material).
export interface SharedMats {
  postMat: THREE.MeshStandardMaterial;
  deckMat: THREE.MeshStandardMaterial;
  rockMat: THREE.MeshStandardMaterial;
  roadMat: THREE.MeshStandardMaterial;
  lampMat: THREE.MeshStandardMaterial;
  winMat: THREE.MeshStandardMaterial;
}

export type AddGlow = (parent: THREE.Object3D, x: number, y: number, z: number, color: number, scale: number) => THREE.Sprite;

// Everything a scene builder needs: the world group to add meshes to, the
// seeded RNG (never Math.random — layout must be identical on every load),
// shared materials/registries, and the glow-sprite helper.
export interface SceneCtx {
  world: THREE.Group;
  dummy: THREE.Object3D;
  rng: Rng;
  reg: SceneRegistry;
  mats: SharedMats;
  addGlow: AddGlow;
}

export const createRegistry = (): SceneRegistry => ({
  glowSprites: [],
  lampMats: [],
  windowMats: [],
  movingBoats: [],
});
