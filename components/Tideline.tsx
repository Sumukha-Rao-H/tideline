'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GammaCorrectionShader } from 'three/examples/jsm/shaders/GammaCorrectionShader.js';

type TimeIdx = 0 | 1 | 2 | 3;
type HotspotKey = 'marina' | 'lighthouse' | 'promenade' | 'grove';

interface Hotspot {
  key: HotspotKey;
  name: string;
  sub: string;
  letter: string;
}

// A single moment in the day cycle. `keyCol`/`keyI` describe the dominant
// celestial light (sun by day, moon by night); `sunGlow`/`moonGlow` drive the
// two sky sprites independently.
interface DayState {
  sky0: THREE.Color;
  sky1: THREE.Color;
  fog: THREE.Color;
  water: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiI: number;
  keyCol: THREE.Color;
  keyI: number;
  lamps: number;
  stars: number;
  sunGlow: number;
  moonGlow: number;
}

interface Keyframe extends DayState {
  at: number; // day fraction this keyframe is anchored to
}

interface MovingBoat {
  m: THREE.Group;
  cx: number;
  cz: number;
  rx: number;
  rz: number;
  sp: number;
  ph: number;
}

interface CamTween {
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  t: number;
  dur: number;
  onDone?: () => void;
}

const TIME_LABELS = ['Morning', 'Afternoon', 'Evening', 'Night'] as const;

const HOTSPOTS: Hotspot[] = [
  { key: 'marina', name: 'The Marina', sub: 'Boats & finger docks', letter: 'M' },
  { key: 'lighthouse', name: 'Lighthouse Point', sub: 'Coastal lookout trail', letter: 'L' },
  { key: 'promenade', name: 'The Promenade', sub: 'Waterfront walk', letter: 'P' },
  { key: 'grove', name: 'Cedar Grove', sub: 'Picnic lawns & pavilion', letter: 'C' },
];

// Camera framings: the scene opens looking straight down (a map) and zooms
// into a low, side-on three-quarter view when the visitor hits "Explore".
const TOP_POS = new THREE.Vector3(2, 132, 22);
const TOP_TARGET = new THREE.Vector3(2, 1, 0);
const SIDE_POS = new THREE.Vector3(40, 33, 53);
const SIDE_TARGET = new THREE.Vector3(2, 3.5, 0);

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// ===================== CONTINUOUS DAY / NIGHT CYCLE =====================
// `day` is a normalised fraction in [0,1): 0 = midnight, 0.25 = sunrise (east),
// 0.5 = noon (overhead), 0.75 = sunset (west). The sun rides a tilted arc and
// the moon sits at the antipode; the palette and light levels are sampled from
// the keyframes below and interpolated, so the scene flows through the day
// instead of snapping between four fixed states.
const TAU = Math.PI * 2;
const DAY_STOPS = [0.3, 0.52, 0.76, 0.95]; // Morning, Afternoon, Evening, Night
const AUTO_DAY_SPEED = 1 / 30; // full cycle ≈ 60s when auto-cycling

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const col = (h: string) => new THREE.Color(h);

// Unit direction toward the sun at a given day fraction (moon = antipode).
const sunDirAt = (day: number, out: THREE.Vector3) => {
  const ang = (day - 0.25) * TAU;
  return out.set(Math.cos(ang), Math.sin(ang), 0.32).normalize();
};

const DAY_KF: Keyframe[] = [
  { at: 0.0, sky0: col('#060a1c'), sky1: col('#0e1838'), fog: col('#0a1430'), water: col('#0c1f33'), hemiSky: col('#101a3a'), hemiGround: col('#05080f'), hemiI: 0.3, keyCol: col('#8fa3d6'), keyI: 0.3, lamps: 1.0, stars: 1.0, sunGlow: 0.0, moonGlow: 1.0 },
  { at: 0.22, sky0: col('#16203f'), sky1: col('#46365c'), fog: col('#2a2740'), water: col('#15324a'), hemiSky: col('#2a3354'), hemiGround: col('#241f33'), hemiI: 0.42, keyCol: col('#7a78ac'), keyI: 0.4, lamps: 0.85, stars: 0.55, sunGlow: 0.12, moonGlow: 0.5 },
  { at: 0.27, sky0: col('#5a6aa0'), sky1: col('#ffb27a'), fog: col('#e8b48a'), water: col('#2f6f8a'), hemiSky: col('#b9c6dd'), hemiGround: col('#6b5a44'), hemiI: 0.6, keyCol: col('#ffae6b'), keyI: 1.05, lamps: 0.35, stars: 0.08, sunGlow: 0.95, moonGlow: 0.08 },
  { at: 0.36, sky0: col('#7fb0d8'), sky1: col('#ffd6a8'), fog: col('#d8e6ef'), water: col('#3f7f96'), hemiSky: col('#cfe2f0'), hemiGround: col('#6f7d52'), hemiI: 0.72, keyCol: col('#ffd2a0'), keyI: 1.2, lamps: 0.05, stars: 0.0, sunGlow: 0.5, moonGlow: 0.0 },
  { at: 0.5, sky0: col('#4f93cf'), sky1: col('#cfeaf6'), fog: col('#dcecf6'), water: col('#2c87a6'), hemiSky: col('#d6effb'), hemiGround: col('#7e8c5c'), hemiI: 0.9, keyCol: col('#fff3df'), keyI: 1.55, lamps: 0.0, stars: 0.0, sunGlow: 0.28, moonGlow: 0.0 },
  { at: 0.64, sky0: col('#4f86c0'), sky1: col('#ecd3a6'), fog: col('#e3ddc9'), water: col('#2b7f9e'), hemiSky: col('#d2e4ee'), hemiGround: col('#84895c'), hemiI: 0.82, keyCol: col('#ffe2bd'), keyI: 1.42, lamps: 0.0, stars: 0.0, sunGlow: 0.42, moonGlow: 0.0 },
  { at: 0.74, sky0: col('#1f3168'), sky1: col('#f0915a'), fog: col('#e7a878'), water: col('#235f7d'), hemiSky: col('#7a6a7e'), hemiGround: col('#5a4636'), hemiI: 0.6, keyCol: col('#ff7a33'), keyI: 1.35, lamps: 0.5, stars: 0.12, sunGlow: 1.0, moonGlow: 0.06 },
  { at: 0.82, sky0: col('#182250'), sky1: col('#b9627e'), fog: col('#6a4a66'), water: col('#1a3f58'), hemiSky: col('#4a4566'), hemiGround: col('#2e2436'), hemiI: 0.46, keyCol: col('#b06a8a'), keyI: 0.72, lamps: 0.85, stars: 0.5, sunGlow: 0.4, moonGlow: 0.4 },
  { at: 0.9, sky0: col('#0a1230'), sky1: col('#1c2a52'), fog: col('#0c1633'), water: col('#102236'), hemiSky: col('#16224a'), hemiGround: col('#070b18'), hemiI: 0.34, keyCol: col('#8fa3d6'), keyI: 0.32, lamps: 1.0, stars: 1.0, sunGlow: 0.06, moonGlow: 0.9 },
];

// Interpolate the keyframe ring into `out` for the given day fraction.
const sampleDay = (day: number, out: DayState) => {
  const kf = DAY_KF;
  const n = kf.length;
  let i = 0;
  while (i < n && kf[i].at <= day) i++;
  const b = kf[i % n];
  const a = kf[(i - 1 + n) % n];
  let span = b.at - a.at;
  if (span <= 0) span += 1; // wrap across midnight
  let local = day - a.at;
  if (local < 0) local += 1;
  const t = span === 0 ? 0 : local / span;
  out.sky0.copy(a.sky0).lerp(b.sky0, t);
  out.sky1.copy(a.sky1).lerp(b.sky1, t);
  out.fog.copy(a.fog).lerp(b.fog, t);
  out.water.copy(a.water).lerp(b.water, t);
  out.hemiSky.copy(a.hemiSky).lerp(b.hemiSky, t);
  out.hemiGround.copy(a.hemiGround).lerp(b.hemiGround, t);
  out.keyCol.copy(a.keyCol).lerp(b.keyCol, t);
  out.hemiI = lerp(a.hemiI, b.hemiI, t);
  out.keyI = lerp(a.keyI, b.keyI, t);
  out.lamps = lerp(a.lamps, b.lamps, t);
  out.stars = lerp(a.stars, b.stars, t);
  out.sunGlow = lerp(a.sunGlow, b.sunGlow, t);
  out.moonGlow = lerp(a.moonGlow, b.moonGlow, t);
};

export default function Tideline() {
  const [activeHotspot, setActiveHotspot] = useState<HotspotKey | null>(null);
  const [timeIdx, setTimeIdx] = useState<TimeIdx>(2);
  const [auto, setAuto] = useState(false);
  const [explored, setExplored] = useState(false);
  const [heroIn, setHeroIn] = useState(false);

  // Fade the hero in on mount (transition-driven, so the same opacity channel
  // can later fade it out smoothly in sync with the camera dive).
  useEffect(() => {
    const id = requestAnimationFrame(() => setHeroIn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);

  // Mutable bridges between React state and the render loop.
  const dayRef = useRef(DAY_STOPS[2]); // current day fraction (starts at Evening)
  const dayTargetRef = useRef(DAY_STOPS[2]); // where the clock is easing toward
  const focusTargetRef = useRef<THREE.Vector3 | null>(null);
  const anchorsRef = useRef<Record<HotspotKey, THREE.Vector3> | null>(null);
  const tweenRef = useRef<CamTween | null>(null);
  const exploreRef = useRef<() => void>(() => {});
  const autoRef = useRef(false);
  const timeIdxRef = useRef<TimeIdx>(2);

  useEffect(() => {
    autoRef.current = auto;
  }, [auto]);

  const setTime = useCallback((i: TimeIdx) => {
    timeIdxRef.current = i;
    setTimeIdx(i);
    dayTargetRef.current = DAY_STOPS[i];
  }, []);

  const startExplore = useCallback(() => {
    setExplored(true);
    setActiveHotspot('marina');
    exploreRef.current();
  }, []);

  // ===================== THREE.JS SCENE =====================
  useEffect(() => {
    const mount = mountRef.current;
    const root = rootRef.current;
    if (!mount || !root) return;

    let mounted = true;
    let raf = 0;

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

    const W = mount.clientWidth || window.innerWidth;
    const H = mount.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.setSize(W, H);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.14; // golden-hour target (handover §1/§9)
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xe7a878, 125, 360);

    const camera = new THREE.PerspectiveCamera(42, W / H, 0.5, 1000);
    camera.position.copy(TOP_POS);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.target.copy(TOP_TARGET);
    controls.minDistance = 34;
    controls.maxDistance = 120;
    controls.minPolarAngle = 0.18;
    controls.maxPolarAngle = 1.18;
    controls.enablePan = false;
    controls.enabled = false; // locked during the top-down intro

    // ---- post-processing: bloom (handover §1, the biggest single lever) ----
    // NOTE: THREE r128 here. There is no OutputPass and no outputColorSpace in
    // this revision, so the chain is RenderPass → UnrealBloomPass → an explicit
    // sRGB gamma pass. RenderPass tone-maps the scene into a *linear* composer
    // target (tone mapping still applies once, via renderer.toneMapping); the
    // final GammaCorrectionShader converts linear→sRGB for the screen. Without
    // it the image renders gamma-dark; OutputPass would do this in newer THREE.
    // Threshold is kept high / strength modest so only genuinely bright things
    // (lamps, lighthouse lamp, the sun glow, sun-kissed water) bloom — not the
    // whole frame — preserving the low-poly look.
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    composer.setSize(W, H);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(W, H), 0.5, 0.55, 0.85);
    composer.addPass(bloomPass);
    composer.addPass(new ShaderPass(GammaCorrectionShader));

    const cur: DayState = {
      sky0: new THREE.Color(), sky1: new THREE.Color(), fog: new THREE.Color(), water: new THREE.Color(),
      hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), keyCol: new THREE.Color(),
      hemiI: 0, keyI: 0, lamps: 0, stars: 0, sunGlow: 0, moonGlow: 0,
    };
    sampleDay(dayRef.current, cur);
    const glowSprites: THREE.SpriteMaterial[] = [];
    const lampMats: THREE.MeshStandardMaterial[] = [];
    const windowMats: THREE.MeshStandardMaterial[] = [];
    const movingBoats: MovingBoat[] = [];

    const addGlow = (parent: THREE.Object3D, x: number, y: number, z: number, color: number, scale: number) => {
      const m = new THREE.SpriteMaterial({ map: glowTex(), color: new THREE.Color(color), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(m);
      s.position.set(x, y, z);
      s.scale.set(scale, scale, 1);
      parent.add(s);
      glowSprites.push(m);
      return s;
    };

    // ---- stars ----
    const starGeo = new THREE.BufferGeometry();
    const sp: number[] = [];
    for (let i = 0; i < 700; i++) {
      const u = Math.random(), v = Math.random();
      const th = 2 * Math.PI * u, ph = Math.acos(2 * v - 1);
      const r = 420;
      const y = Math.abs(r * Math.cos(ph));
      sp.push(r * Math.sin(ph) * Math.cos(th), y, r * Math.sin(ph) * Math.sin(th));
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xcdd6ff, size: 1.5, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    scene.add(new THREE.Points(starGeo, starMat));

    // ---- lights ----
    const hemi = new THREE.HemisphereLight(cur.hemiSky, cur.hemiGround, cur.hemiI);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(cur.keyCol, cur.keyI);
    sun.position.copy(sunDirAt(dayRef.current, new THREE.Vector3())).multiplyScalar(70);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0006;
    const scam = sun.shadow.camera;
    scam.near = 1; scam.far = 220; scam.left = -55; scam.right = 55; scam.top = 55; scam.bottom = -55;
    scene.add(sun);
    scene.add(sun.target);

    const sunSpriteMat = new THREE.SpriteMaterial({ map: glowTex(), color: cur.keyCol.clone(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, opacity: cur.sunGlow });
    const sunSprite = new THREE.Sprite(sunSpriteMat);
    sunSprite.scale.set(90, 90, 1);
    scene.add(sunSprite);

    const moonSpriteMat = new THREE.SpriteMaterial({ map: glowTex(), color: new THREE.Color('#cdd8ff'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, opacity: cur.moonGlow });
    const moonSprite = new THREE.Sprite(moonSpriteMat);
    moonSprite.scale.set(58, 58, 1);
    scene.add(moonSprite);

    // ===================== WORLD =====================
    const world = new THREE.Group();
    scene.add(world);

    const slabMat = new THREE.MeshStandardMaterial({ color: 0x6b5544, roughness: 1, metalness: 0, flatShading: true });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(66, 9, 66, 1, 1, 1), slabMat);
    slab.position.y = -4.5;
    slab.receiveShadow = true;
    world.add(slab);
    const slab2 = new THREE.Mesh(new THREE.BoxGeometry(66.01, 4, 66.01), new THREE.MeshStandardMaterial({ color: 0x4a3a2e, roughness: 1 }));
    slab2.position.y = -7;
    world.add(slab2);

    // land shape
    const shape = new THREE.Shape();
    shape.moveTo(-33, 33);
    shape.lineTo(33, 33);
    shape.lineTo(33, 4);
    shape.lineTo(28, 0);
    shape.bezierCurveTo(22, -2, 18, 2, 14, -3);
    shape.bezierCurveTo(9, -8, 5, -6, 1, -9);
    shape.bezierCurveTo(-2, -11, -3, -18, -7, -18);
    shape.bezierCurveTo(-11, -18, -12, -13, -16, -14);
    shape.bezierCurveTo(-21, -15, -24, -9, -28, -11);
    shape.lineTo(-33, -6);
    shape.lineTo(-33, 33);
    const landGeo = new THREE.ExtrudeGeometry(shape, { depth: 1.1, bevelEnabled: false, steps: 1 });
    landGeo.rotateX(-Math.PI / 2);
    landGeo.computeBoundingBox();
    landGeo.translate(0, 1.1 - landGeo.boundingBox!.max.y, 0);
    landGeo.computeVertexNormals();
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x7a9a55, roughness: 0.95, metalness: 0, flatShading: true });
    const sandMat = new THREE.MeshStandardMaterial({ color: 0xd9c79a, roughness: 1, metalness: 0 });
    const land = new THREE.Mesh(landGeo, [grassMat, sandMat]);
    land.castShadow = true;
    land.receiveShadow = true;
    world.add(land);

    const pts = shape.getPoints(80);
    const inLand = (x: number, wz: number) => {
      const z = -wz;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i].x, zi = pts[i].y, xj = pts[j].x, zj = pts[j].y;
        if (((zi > z) !== (zj > z)) && (x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)) inside = !inside;
      }
      return inside;
    };

    // ---- water ----
    const waterGeo = new THREE.PlaneGeometry(66, 66, 44, 44);
    const waterMat = new THREE.MeshStandardMaterial({ color: cur.water.clone(), roughness: 0.12, metalness: 0.25, transparent: true, opacity: 0.86, flatShading: true });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.62;
    water.receiveShadow = true;
    world.add(water);
    const waterBase = (waterGeo.attributes.position.array as Float32Array).slice();

    // ---- distant ocean + inland mountains (decorative, non-interactive) ----
    // The park lives on a square slab; on its own that block looks like it is
    // floating in empty space. A big sea plane opens the world out to the fog
    // horizon in every direction, while a mountain range rises only on the
    // *inland* side (behind the buildings) — the coast (+Z, toward the camera)
    // stays open water, like a real headland where the land climbs inland and
    // the sea opens out front. None of this is reachable: OrbitControls clamps
    // the camera well inside it (maxDistance 120 vs. mountains at 195+), so the
    // focus stays on the park and this is purely for depth/aesthetics.
    //
    // The sea sits at y=0.22, just under the central water's wave troughs
    // (0.62 mean − 0.32 amplitude ≈ 0.30), so the two surfaces never z-fight; the
    // small drop at the slab edge reads as shallows giving way to deeper water,
    // which also tucks the slab's vertical walls below the surface.
    const seaMat = new THREE.MeshStandardMaterial({ color: cur.water.clone().multiplyScalar(0.82), roughness: 0.5, metalness: 0.18 });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), seaMat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = 0.22;
    scene.add(sea);

    // Warm stone tone; the day/night fog tints it (tan at dusk, cool by day).
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x8c8378, roughness: 1, flatShading: true });
    const backdrop = new THREE.Group();
    // Azimuth math: position = (cos a, sin a) * radius, so sin a = +1 (a = π/2)
    // points at the open coast / camera. Leave that front arc clear and pack a
    // tall, chunky range across the rest — the inland horizon and a little onto
    // the left/right flanks.
    const COAST = Math.PI / 2;   // azimuth of the open sea (toward the camera)
    const GAP = 1.4;             // half-width of the clear coastal opening (rad)
    const SPAN = TAU - 2 * GAP;  // the inland arc the mountains fill
    const HILLS = 90;
    for (let i = 0; i < HILLS; i++) {
      const a = COAST + GAP + Math.random() * SPAN; // anywhere on the inland arc
      const rad = 195 + Math.random() * 95;
      const w = 32 + Math.random() * 32;
      const h = 52 + Math.random() * 78;
      const hill = new THREE.Mesh(new THREE.ConeGeometry(w, h, 4 + Math.floor(Math.random() * 4), 1), hillMat);
      hill.position.set(Math.cos(a) * rad, h / 2 - 8, Math.sin(a) * rad);
      hill.rotation.y = Math.random() * TAU;
      backdrop.add(hill);
    }
    scene.add(backdrop);

    // ---- inland mainland: extend the grass back to meet the mountains ----
    // Behind the park the world was open water right up to the range; fill that
    // gap with a broad grassy headland so the coast reads as the tip of a larger
    // landmass. It sits at the park's grass height (y≈1.08, just under the park's
    // 1.1 so they never z-fight where they overlap) and tucks under the park's
    // back edge; its seaward flanks get the same sandy shore as the park.
    const mShape = new THREE.Shape();
    mShape.moveTo(-150, 26);
    mShape.lineTo(150, 26);                                // front — hidden behind the park
    mShape.bezierCurveTo(205, 60, 232, 120, 185, 205);    // right shore sweeping inland
    mShape.bezierCurveTo(120, 235, 40, 205, -12, 222);    // wavy inland edge (under the hills)
    mShape.bezierCurveTo(-72, 236, -140, 236, -185, 205);
    mShape.bezierCurveTo(-232, 120, -205, 60, -150, 26);  // left shore back to the front
    const mainGeo = new THREE.ExtrudeGeometry(mShape, { depth: 2, bevelEnabled: false, steps: 1 });
    mainGeo.rotateX(-Math.PI / 2);
    mainGeo.computeBoundingBox();
    mainGeo.translate(0, 1.08 - mainGeo.boundingBox!.max.y, 0);
    mainGeo.computeVertexNormals();
    const mainland = new THREE.Mesh(mainGeo, [grassMat, sandMat]);
    mainland.receiveShadow = true;
    world.add(mainland);

    // Point-in-polygon test against the mainland outline (same convention as
    // inLand: world z maps to shape y via z → −z). Used to seed the forest.
    const mPts = mShape.getPoints(120);
    const inMain = (x: number, wz: number) => {
      const z = -wz;
      let inside = false;
      for (let i = 0, j = mPts.length - 1; i < mPts.length; j = i++) {
        const xi = mPts[i].x, zi = mPts[i].y, xj = mPts[j].x, zj = mPts[j].y;
        if (((zi > z) !== (zj > z)) && (x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)) inside = !inside;
      }
      return inside;
    };

    // Rolling grassy foothills bridging the flat plain into the rocky range.
    const moundMat = new THREE.MeshStandardMaterial({ color: 0x6f854c, roughness: 1, flatShading: true });
    for (let i = 0; i < 18; i++) {
      const a = COAST + GAP + Math.random() * SPAN;
      const rad = 120 + Math.random() * 65;
      const w = 22 + Math.random() * 32;
      const h = 7 + Math.random() * 16;
      const mound = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), moundMat);
      mound.position.set(Math.cos(a) * rad, 1.0, Math.sin(a) * rad);
      mound.scale.set(w, h, w);
      mound.rotation.y = Math.random() * TAU;
      mound.receiveShadow = true;
      world.add(mound);
    }

    // ---- trees (instanced) ----
    const dummy = new THREE.Object3D();
    const treeSpots: Array<[number, number, number]> = [];
    const groves: Array<[number, number, number]> = [[18, -10, 7], [25, -22, 6], [9, -24, 6], [-12, -20, 6], [27, -29, 5], [-22, -11, 5], [6, -12, 5], [16, -29, 4], [-6, -27, 4], [1, -18, 4]];
    groves.forEach(([gx, gz, gr]) => {
      for (let i = 0; i < gr * 2.4; i++) {
        const a = Math.random() * Math.PI * 2, rr = Math.random() * gr;
        const x = gx + Math.cos(a) * rr, z = gz + Math.sin(a) * rr;
        if (inLand(x, z)) treeSpots.push([x, z, 0.8 + Math.random() * 0.7]);
      }
    });
    // Inland forest: scatter trees across the new headland's flat plain, in
    // front of the foothills (radius ≲ 120). Skip the park footprint itself.
    for (let i = 0; i < 480; i++) {
      const x = (Math.random() * 2 - 1) * 175;
      const z = -(34 + Math.random() * 86);
      if (inMain(x, z) && !inLand(x, z)) treeSpots.push([x, z, 0.85 + Math.random() * 0.95]);
    }
    const N = treeSpots.length;
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6e4f37, roughness: 1, flatShading: true });
    const folA = new THREE.MeshStandardMaterial({ color: 0x4f7a3f, roughness: 0.95, flatShading: true });
    const folB = new THREE.MeshStandardMaterial({ color: 0x5f8a44, roughness: 0.95, flatShading: true });
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.16, 1, 5), trunkMat, N);
    const fol1 = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.62, 0), folA, N);
    const fol2 = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.46, 0), folB, N);
    trunks.castShadow = fol1.castShadow = fol2.castShadow = true;
    treeSpots.forEach((t, i) => {
      const [x, z, s] = t;
      dummy.position.set(x, 1.1 + 0.5 * s, z); dummy.scale.set(s, s * 1.3, s); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, 1.1 + 1.05 * s, z); dummy.scale.set(s, s, s); dummy.rotation.set(0, Math.random() * 3, 0); dummy.updateMatrix(); fol1.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, 1.1 + 1.55 * s, z); dummy.scale.set(s, s, s); dummy.rotation.set(0, Math.random() * 3, 0); dummy.updateMatrix(); fol2.setMatrixAt(i, dummy.matrix);
    });
    world.add(trunks, fol1, fol2);

    // ---- rocks / breakwater ----
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8783, roughness: 1, flatShading: true });
    const rockSpots: Array<[number, number, number]> = [];
    for (let i = 0; i < 54; i++) {
      const t = i / 54;
      const x = -30 + t * 42, z = 9 + Math.sin(t * 6.5) * 3 + t * 4;
      rockSpots.push([x + (Math.random() - 0.5) * 1.2, z + (Math.random() - 0.5) * 1.2, 0.45 + Math.random() * 0.7]);
    }
    const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), rockMat, rockSpots.length);
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    rockSpots.forEach((r, i) => {
      const [x, z, s] = r;
      dummy.position.set(x, 0.55, z); dummy.scale.set(s * 1.3, s, s * 1.1); dummy.rotation.set(Math.random(), Math.random() * 3, Math.random()); dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix);
    });
    world.add(rocks);

    // ---- promenade path ----
    const pathMat = new THREE.MeshStandardMaterial({ color: 0xcabb98, roughness: 1 });
    const promCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-29, 1.16, 3), new THREE.Vector3(-22, 1.16, 8), new THREE.Vector3(-14, 1.16, 10),
      new THREE.Vector3(-4, 1.16, 9), new THREE.Vector3(4, 1.16, 4), new THREE.Vector3(12, 1.16, 2),
      new THREE.Vector3(20, 1.16, -2), new THREE.Vector3(26, 1.16, -6),
    ]);
    const promGeo = new THREE.TubeGeometry(promCurve, 80, 1.3, 4, false);
    const prom = new THREE.Mesh(promGeo, pathMat);
    prom.scale.set(1, 0.12, 1);
    prom.position.y = 0.02;
    prom.receiveShadow = true;
    world.add(prom);

    // ---- lamp posts ----
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: new THREE.Color(0xffb74d), emissiveIntensity: 0 });
    lampMats.push(lampMat);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.8 });
    for (let i = 0; i <= 12; i++) {
      const p = promCurve.getPoint(i / 12);
      const g = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.7, 6), postMat);
      post.position.y = 0.85;
      post.castShadow = true;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), lampMat);
      head.position.y = 1.75;
      g.add(post, head);
      g.position.set(p.x, 1.16, p.z);
      world.add(g);
      addGlow(world, p.x, 1.16 + 1.75, p.z, 0xffc266, 2.4);
    }

    // ---- pier + finger docks + boats ----
    const deckMat = new THREE.MeshStandardMaterial({ color: 0xb89a6e, roughness: 1 });
    const mkBox = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      world.add(m);
      return m;
    };
    mkBox(2.4, 0.3, 12, -7, 0.75, 21, deckMat);
    for (let i = 0; i < 3; i++) {
      mkBox(6, 0.25, 1.1, -10.5, 0.75, 19 + i * 3, deckMat);
    }
    const mkBoat = (x: number, z: number, col: number, scl: number, rot: number) => {
      const g = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 3.0), new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 }));
      hull.castShadow = true;
      const bow = new THREE.Mesh(new THREE.ConeGeometry(0.65, 1.2, 4), new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 }));
      bow.rotation.x = Math.PI / 2; bow.rotation.y = Math.PI / 4; bow.position.z = 1.9; bow.scale.set(1, 0.42, 1); bow.castShadow = true;
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 1.1), new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.5 }));
      cabin.position.set(0, 0.45, -0.2); cabin.castShadow = true;
      g.add(hull, bow, cabin);
      g.scale.setScalar(scl);
      g.position.set(x, 0.78, z);
      g.rotation.y = rot || 0;
      world.add(g);
      return g;
    };
    mkBoat(-13.5, 19, 0xf4f4f2, 0.9, 0); mkBoat(-13.5, 22, 0xeae6dd, 0.85, 0); mkBoat(-13.5, 25, 0xf4f4f2, 0.95, 0);
    mkBoat(-7, 28, 0xe8e4da, 0.8, 0);
    movingBoats.push({ m: mkBoat(2, 28, 0xf2f2f0, 1.0, 0), cx: 2, cz: 27, rx: 13, rz: 5, sp: 0.09, ph: 0 });
    movingBoats.push({ m: mkBoat(-14, 22, 0xeae6dd, 0.85, 0), cx: -12, cz: 22, rx: 9, rz: 5, sp: -0.06, ph: 2.2 });

    // ---- lighthouse ----
    const lh = new THREE.Group();
    const lhBody = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, 5, 12), new THREE.MeshStandardMaterial({ color: 0xf3efe8, roughness: 0.7 }));
    lhBody.position.y = 2.5 + 1.1; lhBody.castShadow = true;
    const lhBand = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 1.12, 1.1, 12), new THREE.MeshStandardMaterial({ color: 0xc94f3d, roughness: 0.7 }));
    lhBand.position.y = 2.6 + 1.1;
    const lhTop = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.9, 12), new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6 }));
    lhTop.position.y = 5.1 + 1.1;
    const lhLantern = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.9, 12), lampMat);
    lhLantern.position.y = 5.05 + 1.1;
    const lhCap = new THREE.Mesh(new THREE.ConeGeometry(0.8, 0.8, 12), new THREE.MeshStandardMaterial({ color: 0xc94f3d, roughness: 0.7 }));
    lhCap.position.y = 5.95 + 1.1;
    lh.add(lhBody, lhBand, lhTop, lhLantern, lhCap);
    lh.position.set(27, 0, -3);
    world.add(lh);
    addGlow(world, 27, 6.15, -3, 0xffd58a, 5);
    const lhLight = new THREE.PointLight(0xffce8a, 0, 40);
    lhLight.position.set(27, 6.2, -3);
    world.add(lhLight);

    // ---- lighthouse beam (handover §7, the hero moment) ----
    // A slim additive cone sweeps a seaward arc from the lamp, with a matching
    // streak on the water reading as its reflection, plus a real SpotLight that
    // actually lights the water. All three fade in with the day cycle (dark at
    // noon, strong at dusk/night) and are carried by the bloom pass.
    const BEAM_LEN = 44;
    const beamGeo = new THREE.ConeGeometry(3.0, BEAM_LEN, 18, 1, true);
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
    beamPivot.position.set(27, 6.15, -3);
    beamPivot.add(new THREE.Mesh(beamGeo, beamMat));
    world.add(beamPivot);

    const streakGeo = new THREE.PlaneGeometry(2.6, 40, 1, 1);
    streakGeo.rotateX(-Math.PI / 2);
    streakGeo.translate(0, 0, 20); // runs +Z out from the lighthouse base
    const streakColors = new Float32Array(streakGeo.attributes.position.count * 3);
    {
      const p = streakGeo.attributes.position.array as Float32Array;
      for (let i = 0; i < streakGeo.attributes.position.count; i++) {
        const t = Math.max(0, Math.min(1, 1 - p[i * 3 + 2] / 40)); // bright at base → fades seaward
        streakColors[i * 3] = 1.0 * t; streakColors[i * 3 + 1] = 0.8 * t; streakColors[i * 3 + 2] = 0.46 * t;
      }
    }
    streakGeo.setAttribute('color', new THREE.Float32BufferAttribute(streakColors, 3));
    const streakMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, opacity: 0 });
    const streakPivot = new THREE.Group();
    streakPivot.position.set(27, 0.66, -3);
    streakPivot.add(new THREE.Mesh(streakGeo, streakMat));
    world.add(streakPivot);

    const lhSpot = new THREE.SpotLight(0xffd9a0, 0, 52, 0.15, 0.7, 1);
    const lhSpotTarget = new THREE.Object3D();
    lhSpotTarget.position.set(0, -5.5, 40); // out and down along the beam
    beamPivot.add(lhSpot, lhSpotTarget);
    lhSpot.target = lhSpotTarget;

    // ---- pavilion ----
    const pav = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.25, 8), new THREE.MeshStandardMaterial({ color: 0xb89a6e, roughness: 1 }));
    deck.position.y = 1.22; deck.receiveShadow = true;
    pav.add(deck);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2, 6), postMat);
      post.position.set(Math.cos(a) * 2.1, 2.3, Math.sin(a) * 2.1);
      post.castShadow = true;
      pav.add(post);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.1, 1.5, 6), new THREE.MeshStandardMaterial({ color: 0xb5503f, roughness: 0.8 }));
    roof.position.y = 4.1; roof.castShadow = true;
    pav.add(roof);
    pav.position.set(-19, 0, -7);
    world.add(pav);

    // ---- backdrop buildings ----
    const winMat = new THREE.MeshStandardMaterial({ color: 0xfff0cf, emissive: new THREE.Color(0xffd27a), emissiveIntensity: 0 });
    windowMats.push(winMat);
    const concrete = [0xd7d2c8, 0xcdc7bb, 0xe0dccf];
    for (let i = 0; i < 9; i++) {
      const x = 8 + i * 2.6 + (Math.random() - 0.5);
      const z = -29 - (i % 2) * 2.4;
      const h = 4 + Math.random() * 7;
      const w = 1.8 + Math.random() * 1.2;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), new THREE.MeshStandardMaterial({ color: concrete[i % 3], roughness: 0.85 }));
      b.position.set(x, 1.1 + h / 2, z); b.castShadow = true; b.receiveShadow = true;
      world.add(b);
      const win = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, h * 0.7, w * 0.7), winMat);
      win.position.set(x, 1.1 + h / 2, z);
      win.scale.setScalar(1.001);
      world.add(win);
      addGlow(world, x, 1.1 + h * 0.6, z + w * 0.5, 0xffcf8a, 2.0);
    }

    // ---- inland pond ----
    const pond = new THREE.Mesh(new THREE.CircleGeometry(3, 18), new THREE.MeshStandardMaterial({ color: 0x3f8aa6, roughness: 0.2, metalness: 0.3, transparent: true, opacity: 0.85 }));
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(15, 1.13, -16);
    world.add(pond);

    // ---- hotspot anchors ----
    const anchors: Record<HotspotKey, THREE.Vector3> = {
      marina: new THREE.Vector3(-8, 2.6, 22),
      lighthouse: new THREE.Vector3(27, 7.8, -3),
      promenade: new THREE.Vector3(6, 2.6, 6),
      grove: new THREE.Vector3(-19, 5.0, -7),
    };
    anchorsRef.current = anchors;

    // Kick off the cinematic zoom from the top-down map into the side view.
    exploreRef.current = () => {
      if (tweenRef.current) return;
      controls.enabled = false;
      focusTargetRef.current = null;
      tweenRef.current = {
        fromPos: camera.position.clone(),
        toPos: SIDE_POS.clone(),
        fromTarget: controls.target.clone(),
        toTarget: SIDE_TARGET.clone(),
        t: 0,
        dur: 2.0,
        onDone: () => {
          controls.enabled = true;
        },
      };
    };

    // ===================== ANIMATE =====================
    const clock = new THREE.Clock();
    const tmpV = new THREE.Vector3();
    const sunVec = new THREE.Vector3();
    const moonVec = new THREE.Vector3();

    const animate = () => {
      if (!mounted) return;
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const et = clock.elapsedTime;

      // water
      const pos = water.geometry.attributes.position;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < pos.count; i++) {
        const ix = i * 3;
        const x = waterBase[ix], y = waterBase[ix + 1];
        arr[ix + 2] = Math.sin(x * 0.35 + et * 1.1) * 0.16 + Math.cos(y * 0.4 + et * 0.85) * 0.16;
      }
      pos.needsUpdate = true;
      water.geometry.computeVertexNormals();

      // moving boats
      movingBoats.forEach((b) => {
        const a = et * b.sp + b.ph;
        const x = b.cx + Math.cos(a) * b.rx, z = b.cz + Math.sin(a) * b.rz;
        const x2 = b.cx + Math.cos(a + 0.05) * b.rx, z2 = b.cz + Math.sin(a + 0.05) * b.rz;
        b.m.position.set(x, 0.78 + Math.sin(et * 1.6 + b.ph) * 0.05, z);
        b.m.rotation.y = Math.atan2(x2 - x, z2 - z);
      });

      // ---- advance the day/night clock ----
      let day = dayRef.current;
      if (autoRef.current) {
        day = (day + dt * AUTO_DAY_SPEED) % 1; // a full cycle when auto-running
        dayTargetRef.current = day;
        // keep the time pills lit on whichever preset is nearest
        let best = 0;
        let bd = 9;
        for (let i = 0; i < DAY_STOPS.length; i++) {
          let d = Math.abs(DAY_STOPS[i] - day);
          d = Math.min(d, 1 - d);
          if (d < bd) { bd = d; best = i; }
        }
        if (best !== timeIdxRef.current) { timeIdxRef.current = best as TimeIdx; setTimeIdx(best as TimeIdx); }
      } else {
        let diff = dayTargetRef.current - day;
        diff -= Math.round(diff); // travel the short way around the clock
        day = (day + diff * (1 - Math.exp(-dt * 1.5)) + 1) % 1;
      }
      dayRef.current = day;
      sampleDay(day, cur);

      // ---- place the sun & moon, light from whichever is up ----
      sunDirAt(day, sunVec);
      moonVec.copy(sunVec).negate();
      const keyVec = sunVec.y >= -0.04 ? sunVec : moonVec; // hand off near the horizon
      sun.position.copy(keyVec).multiplyScalar(70);
      sun.color.copy(cur.keyCol);
      sun.intensity = cur.keyI;

      // ---- apply the sampled palette ----
      root.style.background = 'linear-gradient(180deg,' + cur.sky0.getStyle() + ' 0%,' + cur.sky1.getStyle() + ' 76%)';
      hemi.color.copy(cur.hemiSky); hemi.groundColor.copy(cur.hemiGround); hemi.intensity = cur.hemiI;
      scene.fog!.color.copy(cur.fog); waterMat.color.copy(cur.water);
      seaMat.color.copy(cur.water).multiplyScalar(0.82); // deeper offshore water tracks the palette
      lampMats.forEach((m) => (m.emissiveIntensity = cur.lamps * 1.4));
      windowMats.forEach((m) => (m.emissiveIntensity = cur.lamps * 1.1));
      glowSprites.forEach((m) => (m.opacity = cur.lamps * 0.9));
      starMat.opacity = cur.stars;
      lhLight.intensity = cur.lamps * 2.2;
      // sweep the lighthouse beam across the bay and fade it with the day cycle
      const beamSweep = 0.3 + Math.sin(et * 0.3) * 0.7;
      beamPivot.rotation.y = beamSweep;
      streakPivot.rotation.y = beamSweep;
      beamMat.opacity = cur.lamps * 0.7;
      streakMat.opacity = cur.lamps * 0.85;
      lhSpot.intensity = cur.lamps * 2.2;
      sunSprite.position.copy(sunVec).multiplyScalar(320);
      sunSprite.material.color.copy(cur.keyCol);
      sunSprite.material.opacity = cur.sunGlow;
      moonSprite.position.copy(moonVec).multiplyScalar(320);
      moonSprite.material.opacity = cur.moonGlow;

      // camera: intro/explore tween takes priority over hotspot focus
      const tw = tweenRef.current;
      if (tw) {
        tw.t = Math.min(1, tw.t + dt / tw.dur);
        const e = easeInOut(tw.t);
        camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
        controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
        if (tw.t >= 1) {
          tweenRef.current = null;
          tw.onDone?.();
        }
      } else if (focusTargetRef.current) {
        controls.target.lerp(focusTargetRef.current, 1 - Math.exp(-dt * 4));
        if (controls.target.distanceTo(focusTargetRef.current) < 0.05) focusTargetRef.current = null;
      }

      controls.update();
      composer.render();

      // project hotspots
      const cw = mount.clientWidth, ch = mount.clientHeight;
      const nodes = root.querySelectorAll<HTMLElement>('[data-hotspot]');
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        const key = el.dataset.hotspot as HotspotKey | undefined;
        if (!key) continue;
        const a = anchors[key];
        if (!a) continue;
        tmpV.copy(a).project(camera);
        const on = tmpV.z < 1 && tmpV.x >= -1.05 && tmpV.x <= 1.05 && tmpV.y >= -1.05 && tmpV.y <= 1.05;
        if (!on) {
          el.style.opacity = '0';
          el.style.pointerEvents = 'none';
          continue;
        }
        el.style.opacity = '1';
        el.style.pointerEvents = '';
        el.style.transform = 'translate(' + (tmpV.x * 0.5 + 0.5) * cw + 'px,' + (-tmpV.y * 0.5 + 0.5) * ch + 'px)';
      }
    };
    animate();

    const onResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      mounted = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      composer.renderTarget1.dispose();
      composer.renderTarget2.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setTime]);

  // ===================== OVERLAY =====================
  const onHotspotEnter = (key: HotspotKey) => setActiveHotspot(key);
  const onHotspotClick = (key: HotspotKey) => setActiveHotspot((prev) => (prev === key ? null : key));
  const onHotspotArrow = (key: HotspotKey) => {
    setActiveHotspot(key);
    if (anchorsRef.current) focusTargetRef.current = anchorsRef.current[key].clone().setY(2.5);
  };

  return (
    <div
      ref={rootRef}
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: 'linear-gradient(180deg,#1f3168 0%,#f0915a 76%)',
      }}
    >
      <div ref={mountRef} style={{ position: 'absolute', inset: 0, zIndex: 0 }} />

      <div style={{ position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none' }}>
        {/* NAV */}
        <div
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', padding: '22px 36px', pointerEvents: 'auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <span style={{ display: 'inline-block', width: 22, height: 22, background: '#F4B65A', transform: 'rotate(45deg)', borderRadius: 5, boxShadow: '0 0 16px rgba(244,182,90,.6)' }} />
            <span style={{ fontFamily: "'Space Grotesk'", fontWeight: 600, fontSize: 19, letterSpacing: '.08em', color: '#fff' }}>TIDELINE</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 30 }}>
              {['Map', 'Trails', 'Visit', 'Events'].map((l) => (
                <a key={l} style={{ color: 'rgba(255,255,255,.86)', fontSize: 15, textDecoration: 'none', cursor: 'pointer' }}>{l}</a>
              ))}
            </div>
            <button style={{ background: '#fff', color: '#13202e', fontSize: 14, fontWeight: 600, border: 'none', padding: '11px 22px', borderRadius: 40, cursor: 'pointer', fontFamily: 'inherit' }}>Plan your visit</button>
          </div>
        </div>

        {/* HERO: centered — fades out as the camera dives in */}
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', textAlign: 'center', paddingBottom: 40,
            opacity: explored ? 0 : heroIn ? 1 : 0,
            transform: explored
              ? 'translateY(-10px) scale(1.06)'
              : heroIn
                ? 'none'
                : 'translateY(14px)',
            // Quick, gentle entry — then a long, eased exit timed to the 2s camera dive.
            transition: explored
              ? 'opacity 1.9s cubic-bezier(.33,0,.25,1), transform 2.1s cubic-bezier(.33,0,.25,1)'
              : 'opacity .8s ease, transform .8s ease',
            pointerEvents: 'none',
          }}
        >
          <span style={{ fontSize: 13, letterSpacing: '.36em', textTransform: 'uppercase', color: 'rgba(255,255,255,.72)' }}>Waterfront Park</span>
          <h1 style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 'clamp(64px,12vw,168px)', lineHeight: '.9', letterSpacing: '-.03em', color: '#fff', margin: '16px 0 0', textShadow: '0 4px 50px rgba(0,0,0,.45)' }}>Tideline</h1>
          <p style={{ margin: '24px 0 0', maxWidth: 460, fontSize: 18, lineHeight: 1.5, color: 'rgba(255,255,255,.84)', textShadow: '0 1px 14px rgba(0,0,0,.3)' }}>
            A coastal park reimagined — explore it from first light to the last star.
          </p>
          <div style={{ display: 'flex', gap: 14, marginTop: 34, pointerEvents: explored ? 'none' : 'auto' }}>
            <button onClick={startExplore} style={{ background: '#fff', color: '#13202e', fontSize: 15, fontWeight: 600, border: 'none', padding: '14px 28px', borderRadius: 40, cursor: 'pointer', fontFamily: 'inherit' }}>Explore the map</button>
            <button style={{ background: 'rgba(10,14,20,.5)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', border: '1px solid rgba(255,255,255,.18)', color: '#fff', fontSize: 15, fontWeight: 500, padding: '14px 28px', borderRadius: 40, cursor: 'pointer', fontFamily: 'inherit' }}>Plan a visit</button>
          </div>
        </div>

        {/* HOTSPOTS */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {HOTSPOTS.map((item) => {
            const isActive = activeHotspot === item.key;
            return (
              <div key={item.key} data-hotspot={item.key} style={{ position: 'absolute', left: 0, top: 0, willChange: 'transform', opacity: 0 }}>
                {isActive && (
                  <div style={{ position: 'absolute', left: '50%', bottom: 24, transform: 'translateX(-50%)', pointerEvents: 'auto', animation: 'tl-fadeup .26s ease both' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'rgba(13,17,24,.6)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', border: '1px solid rgba(255,255,255,.16)', borderRadius: 17, padding: '11px 13px 11px 14px', whiteSpace: 'nowrap', boxShadow: '0 20px 54px rgba(0,0,0,.46)' }}>
                      <div style={{ width: 38, height: 38, borderRadius: 11, background: 'rgba(244,182,90,.14)', border: '1px solid rgba(244,182,90,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Space Grotesk'", fontWeight: 600, fontSize: 17, color: '#F4B65A' }}>{item.letter}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingRight: 6 }}>
                        <div style={{ fontFamily: "'Space Grotesk'", fontWeight: 600, fontSize: 16, color: '#fff' }}>{item.name}</div>
                        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.6)' }}>{item.sub}</div>
                      </div>
                      <button onClick={() => onHotspotArrow(item.key)} style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid rgba(255,255,255,.22)', background: 'rgba(255,255,255,.06)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>&#8594;</button>
                    </div>
                    <div style={{ position: 'absolute', left: '50%', top: '100%', width: 1, height: 24, background: 'linear-gradient(rgba(255,255,255,.55),rgba(255,255,255,0))', transform: 'translateX(-50%)' }} />
                  </div>
                )}
                <button
                  onClick={() => onHotspotClick(item.key)}
                  onMouseEnter={() => onHotspotEnter(item.key)}
                  style={{ position: 'absolute', left: 0, top: 0, transform: 'translate(-50%,-50%)', width: 22, height: 22, border: 'none', padding: 0, cursor: 'pointer', pointerEvents: 'auto', background: 'transparent' }}
                >
                  <span style={{ position: 'absolute', left: '50%', top: '50%', width: 13, height: 13, borderRadius: '50%', background: '#F4B65A', boxShadow: '0 0 16px 3px rgba(244,182,90,.85)', transform: 'translate(-50%,-50%)' }} />
                  <span style={{ position: 'absolute', left: '50%', top: '50%', width: 13, height: 13, borderRadius: '50%', border: '1.5px solid rgba(244,182,90,.7)', transform: 'translate(-50%,-50%)', animation: 'tl-pulse 2.6s ease-out infinite' }} />
                </button>
              </div>
            );
          })}
        </div>

        {/* BOTTOM LEFT: hint */}
        <div style={{ position: 'absolute', left: 36, bottom: 36, display: 'flex', alignItems: 'center', gap: 16, pointerEvents: 'auto' }}>
          <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,.5)', letterSpacing: '.02em' }}>
            {explored ? 'Drag to look around · scroll to zoom' : 'Hit explore to dive in'}
          </span>
        </div>

        {/* BOTTOM RIGHT: time of day */}
        <div style={{ position: 'absolute', right: 36, bottom: 36, display: 'flex', alignItems: 'center', gap: 10, pointerEvents: 'auto' }}>
          <div style={{ display: 'flex', background: 'rgba(10,14,20,.46)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 40, padding: 5, gap: 2 }}>
            {TIME_LABELS.map((label, i) => (
              <button key={label} onClick={() => setTime(i as TimeIdx)} style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 500, padding: '9px 16px', borderRadius: 30, background: timeIdx === i ? 'rgba(244,182,90,.92)' : 'transparent', color: timeIdx === i ? '#1a1206' : 'rgba(255,255,255,.78)' }}>{label}</button>
            ))}
          </div>
          <button onClick={() => setAuto((a) => !a)} title="Auto cycle" style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid rgba(255,255,255,.16)', background: auto ? 'rgba(244,182,90,.92)' : 'rgba(255,255,255,.06)', color: auto ? '#1a1206' : '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontFamily: 'inherit' }}>
            {auto ? '❙❙' : '▶'}
          </button>
        </div>
      </div>
    </div>
  );
}
