import * as THREE from 'three';
import { sunDirAt, type DayState } from '@/lib/dayCycle';
import type { AddGlow, SceneRegistry } from './types';

export interface Sky {
  addGlow: AddGlow;
  starMat: THREE.PointsMaterial;
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  sunSprite: THREE.Sprite;
  sunSpriteMat: THREE.SpriteMaterial;
  moonSprite: THREE.Sprite;
  moonSpriteMat: THREE.SpriteMaterial;
}

// Stars, hemisphere + key light, and the sun/moon glow sprites — plus the
// shared `addGlow` helper every builder uses for lamp/window halos.
export const createSky = (scene: THREE.Scene, cur: DayState, day: number, reg: SceneRegistry): Sky => {
  // ---- glow sprite texture ----
  let glowTexCache: THREE.CanvasTexture | null = null;
  const glowTex = (): THREE.CanvasTexture => {
    if (glowTexCache) return glowTexCache;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    glowTexCache = new THREE.CanvasTexture(c);
    return glowTexCache;
  };

  const addGlow: AddGlow = (parent, x, y, z, color, scale) => {
    const m = new THREE.SpriteMaterial({ map: glowTex(), color: new THREE.Color(color), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
    const s = new THREE.Sprite(m);
    s.position.set(x, y, z);
    s.scale.set(scale, scale, 1);
    parent.add(s);
    reg.glowSprites.push(m);
    return s;
  };

  // ---- stars ----
  // Deterministic star field: a low-discrepancy angle/height walk rather than
  // random samples, so the same sky renders every night.
  const starGeo = new THREE.BufferGeometry();
  const sp: number[] = [];
  for (let i = 0; i < 900; i++) {
    const u = (i * 0.6180339887498949) % 1; // golden-ratio walk around the dome
    const v = ((i * 0.7548776662466927) + 0.382) % 1;
    const th = 2 * Math.PI * u, ph = Math.acos(2 * v - 1);
    const r = 900;
    const y = Math.abs(r * Math.cos(ph));
    sp.push(r * Math.sin(ph) * Math.cos(th), y + 40, r * Math.sin(ph) * Math.sin(th));
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xcdd6ff, size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
  scene.add(new THREE.Points(starGeo, starMat));

  // ---- lights ----
  const hemi = new THREE.HemisphereLight(cur.hemiSky, cur.hemiGround, cur.hemiI);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(cur.keyCol, cur.keyI);
  sun.position.copy(sunDirAt(day, new THREE.Vector3())).multiplyScalar(200);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  const scam = sun.shadow.camera;
  scam.near = 1; scam.far = 700; scam.left = -180; scam.right = 180; scam.top = 180; scam.bottom = -180;
  scene.add(sun);
  scene.add(sun.target);

  const sunSpriteMat = new THREE.SpriteMaterial({ map: glowTex(), color: cur.keyCol.clone(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false, opacity: cur.sunGlow });
  const sunSprite = new THREE.Sprite(sunSpriteMat);
  sunSprite.scale.set(200, 200, 1);
  scene.add(sunSprite);

  const moonSpriteMat = new THREE.SpriteMaterial({ map: glowTex(), color: new THREE.Color('#cdd8ff'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false, opacity: cur.moonGlow });
  const moonSprite = new THREE.Sprite(moonSpriteMat);
  moonSprite.scale.set(150, 150, 1);
  scene.add(moonSprite);

  return { addGlow, starMat, hemi, sun, sunSprite, sunSpriteMat, moonSprite, moonSpriteMat };
};
