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
// Tuned to the large procedural coastline (terrain spans ~±460u; the lived-in
// coast sits around z≈24–86, mountains recede inland at negative z).
const TOP_POS = new THREE.Vector3(16, 218, 50);
const TOP_TARGET = new THREE.Vector3(0, 8, 22);
const SIDE_POS = new THREE.Vector3(145, 58, 81);
const SIDE_TARGET = new THREE.Vector3(0, 8, 22);

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
    scene.fog = new THREE.Fog(0xe7b389, 200, 680); // distances for the big coastline; colour driven by the day cycle

    const camera = new THREE.PerspectiveCamera(42, W / H, 0.5, 3000);
    camera.position.copy(TOP_POS);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.target.copy(TOP_TARGET);
    controls.minDistance = 60;
    controls.maxDistance = 420;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = 1.45;
    controls.enablePan = false;
    controls.enabled = false; // locked during the top-down intro

    // ---- post-processing: bloom (handover §1, the biggest single lever) ----
    // THREE r128: no OutputPass / outputColorSpace, so the chain is
    // RenderPass → UnrealBloomPass → explicit sRGB gamma pass. RenderPass
    // tone-maps into a linear composer target; the GammaCorrectionShader
    // converts linear→sRGB. Threshold high / strength modest so only genuinely
    // bright things bloom (lamps, lighthouse lamp, sun glow, sun-kissed water).
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
    for (let i = 0; i < 900; i++) {
      const u = Math.random(), v = Math.random();
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
    sun.position.copy(sunDirAt(dayRef.current, new THREE.Vector3())).multiplyScalar(200);
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

    // ===================== WORLD (procedural coastline — design map) =====================
    const world = new THREE.Group();
    scene.add(world);
    const dummy = new THREE.Object3D();

    // ---- terrain field functions ----
    const seed = 21.7;
    const hash = (x: number, y: number) => { const n = Math.sin(x * 127.1 + y * 311.7 + seed) * 43758.5453; return n - Math.floor(n); };
    const vnoise = (x: number, y: number) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
      return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
    };
    const fbm = (x: number, y: number, oct = 5) => { let s = 0, a = 0.5, f = 1, m = 0; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); m += a; f *= 2; a *= 0.5; } return s / m; };
    const ridged = (x: number, y: number, oct = 5) => { let s = 0, a = 0.5, f = 1, m = 0; for (let i = 0; i < oct; i++) { const n = 1 - Math.abs(vnoise(x * f, y * f) * 2 - 1); s += a * n * n; m += a; f *= 2; a *= 0.5; } return s / m; };
    const sstep = (a: number, b: number, x: number) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };

    const oceanField = (x: number, z: number) => { const wig = (fbm(x * 0.004 + 10, z * 0.004 + 3, 4) - 0.5) * 34; return x * 0.5 + z * 0.95 - 58 + wig; };
    const landHeight = (x: number, z: number) => {
      const hills = (fbm(x * 0.004 + 2, z * 0.004 + 9, 5) - 0.32) * 30;
      let h = Math.max(hills, 1.6); // floor well above the water so flat coastal land never dips to the waterline
      const mMask = sstep(-20, -200, z);
      const mBig = 0.35 + fbm(x * 0.0020 + 1, z * 0.0020 + 4, 4) * 0.85;
      const ridge = ridged(x * 0.0042 + 5, z * 0.0042 + 1, 5);
      h += mMask * mBig * ridge * 195;
      return h;
    };
    // Long sandy beach: inland land ramps gently down across a wide sand flat to
    // the waterline (a real beach, not a cliff), then a shallow underwater slope
    // runs out to the deep seabed. BEACH widens/narrows the dry sand band.
    const BEACH = 26;   // beach width in oceanField units (bigger = longer beach)
    const SEAW = 30;    // underwater slope width out to deep water
    const WLINE = -0.35; // sand height at the waterline (just under the ocean surface)
    const sampleHeight = (x: number, z: number) => {
      const o = oceanField(x, z);
      if (o <= -BEACH) return landHeight(x, z);                                   // inland
      if (o < 0) { const tb = sstep(-BEACH, 0, o); return lerp(Math.max(landHeight(x, z), 1.6), WLINE, tb); } // dry sand
      const td = sstep(0, SEAW, o); return lerp(WLINE, -13, td);                  // submerged slope
    };
    const shoreZ = (x: number) => { for (let z = 210; z > -70; z -= 2) { if (oceanField(x, z) < 0) return z; } return 0; };
    // z at the back of the beach (where the sand meets grass) for column x.
    // Anything that shouldn't sit on the sand — roads, houses, apartments, the
    // lighthouse — is anchored behind this line rather than behind the waterline.
    const backZ = (x: number) => { let z = shoreZ(x); for (let i = 0; i < 90 && oceanField(x, z) > -BEACH; i++) z -= 1; return z; };

    // ---- terrain mesh (snow-capped peaks, grass, sand, rock via vertex colour) ----
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
    const terrain = new THREE.Mesh(tng, terrainMat); terrain.receiveShadow = true; world.add(terrain);

    // ---- ocean (animated swell + depth tint + rolling shoreline wave foam) ----
    // Each vertex carries its `oField` (the same signed coast field the terrain
    // uses): 0 at the waterline, growing seaward. The fragment shader turns that
    // into a depth gradient plus a foam band whose position oscillates in and out
    // over time — waves washing up and receding on the sand.
    const oceanGeo = new THREE.PlaneGeometry(1500, 1500, 110, 110); oceanGeo.rotateX(-Math.PI / 2);
    const oPos = oceanGeo.attributes.position;
    const oField = new Float32Array(oPos.count);
    for (let i = 0; i < oPos.count; i++) oField[i] = oceanField(oPos.getX(i), oPos.getZ(i));
    oceanGeo.setAttribute('oField', new THREE.Float32BufferAttribute(oField, 1));
    const oceanUniforms = {
      uTime: { value: 0 },
      uShallow: { value: cur.water.clone().lerp(new THREE.Color(0xffffff), 0.25) },
      uDeep: { value: cur.water.clone().multiplyScalar(0.7) },
      uFoam: { value: new THREE.Color(0xeef4ff) },
    };
    const oceanMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.18, metalness: 0.25, transparent: true, opacity: 0.97, flatShading: true });
    oceanMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = oceanUniforms.uTime;
      sh.uniforms.uShallow = oceanUniforms.uShallow;
      sh.uniforms.uDeep = oceanUniforms.uDeep;
      sh.uniforms.uFoam = oceanUniforms.uFoam;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n attribute float oField;\n varying float vO;\n varying vec2 vXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n vO = oField;\n vXZ = vec2(position.x, position.z);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n uniform float uTime;\n uniform vec3 uShallow;\n uniform vec3 uDeep;\n uniform vec3 uFoam;\n varying float vO;\n varying vec2 vXZ;')
        .replace('#include <color_fragment>', `#include <color_fragment>
           float depthT = smoothstep(0.0, 70.0, vO);
           vec3 wbase = mix(uShallow, uDeep, depthT);
           float wash = 8.0 + 5.0 * sin(uTime * 0.7 + vXZ.x * 0.03 + vXZ.y * 0.02);
           float swash = smoothstep(wash, wash - 5.0, vO) * smoothstep(-3.0, 1.5, vO);
           float ripple = 0.55 + 0.45 * sin(vO * 1.1 - uTime * 3.0 + vXZ.x * 0.05);
           float edge = (1.0 - smoothstep(0.0, 2.4, vO)) * 0.5;
           float foam = clamp(swash * ripple + edge, 0.0, 1.0);
           diffuseColor.rgb = mix(wbase, uFoam, foam);`);
    };
    const ocean = new THREE.Mesh(oceanGeo, oceanMat); ocean.position.y = -0.2; ocean.receiveShadow = true; world.add(ocean);
    const waterBase = (oceanGeo.attributes.position.array as Float32Array).slice();

    // ---- trees (instanced conifers) ----
    const treeSpots: Array<[number, number, number, number]> = [];
    for (let i = 0; i < 5200 && treeSpots.length < 950; i++) {
      const x = (Math.random() - 0.5) * 540, z = -150 + Math.random() * 330;
      const o = oceanField(x, z); if (o > -6) continue;
      const h = sampleHeight(x, z); if (h < 1.6 || h > 34) continue;
      const sl = Math.abs(sampleHeight(x + 2, z) - sampleHeight(x - 2, z)) + Math.abs(sampleHeight(x, z + 2) - sampleHeight(x, z - 2));
      if (sl > 5.5) continue;
      treeSpots.push([x, h, z, 0.8 + Math.random() * 1.15]);
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
      const g = new THREE.Color(greens[(Math.random() * greens.length) | 0]);
      cone1.setColorAt(i, g); cone2.setColorAt(i, g);
    });
    if (cone1.instanceColor) cone1.instanceColor.needsUpdate = true;
    if (cone2.instanceColor) cone2.instanceColor.needsUpdate = true;
    world.add(trunks, cone1, cone2);

    // ---- rocks (shoreline + scattered) ----
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8c8782, roughness: 1, flatShading: true });
    const rockSpots: Array<[number, number, number, number]> = [];
    // Only sparse rocks scattered on inland slopes now — the shore is sandy beach,
    // not a rocky edge (the lighthouse keeps its own rocky base below).
    for (let i = 0; i < 2600 && rockSpots.length < 150; i++) {
      const x = (Math.random() - 0.5) * 500, z = -70 + Math.random() * 250; const o = oceanField(x, z);
      if (o < -28) { const h = sampleHeight(x, z); if (h > 2 && h < 28 && Math.random() < 0.05) rockSpots.push([x, h, z, 0.4 + Math.random() * 0.9]); }
    }
    const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), rockMat, rockSpots.length);
    rocks.castShadow = rocks.receiveShadow = true;
    rockSpots.forEach((r, i) => { const [x, h, z, s] = r; dummy.position.set(x, h + s * 0.15, z); dummy.scale.set(s * 1.3, s, s * 1.1); dummy.rotation.set(Math.random(), Math.random() * 3, Math.random()); dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix); });
    world.add(rocks);

    const postMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.8 });
    const deckMat = new THREE.MeshStandardMaterial({ color: 0xb89a6e, roughness: 1 });
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
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: new THREE.Color(0xffb74d), emissiveIntensity: 0 });
    lampMats.push(lampMat);
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
    movingBoats.push({ m: mkBoat(0, pz + 40, 0xf2f2f0, 1.1, 0), cx: -6, cz: pz + 44, rx: 34, rz: 14, sp: 0.05, ph: 0 });
    movingBoats.push({ m: mkBoat(40, pz + 20, 0xeae6dd, 0.95, 0), cx: 30, cz: pz + 26, rx: 22, rz: 11, sp: -0.04, ph: 2.2 });

    // ---- lighthouse (rocky base + tower) ----
    // Sits on the headland just behind the beach, not out on the open sand.
    const lz = backZ(70) - 2;
    const lhBaseY = Math.max(sampleHeight(70, lz), 0.7);
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; const rr = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1 + Math.random() * 0.7, 0), rockMat); rr.position.set(70 + Math.cos(a) * 2.4, lhBaseY - 0.3, lz + Math.sin(a) * 2.4); rr.rotation.set(Math.random(), Math.random() * 3, Math.random()); rr.castShadow = true; world.add(rr); }
    const lh = new THREE.Group();
    const lhBody = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.5, 5.2, 14), new THREE.MeshStandardMaterial({ color: 0xf3efe8, roughness: 0.7 })); lhBody.position.y = 3.0; lhBody.castShadow = true;
    const lhBand = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 1.2, 1.1, 14), new THREE.MeshStandardMaterial({ color: 0xc94f3d, roughness: 0.7 })); lhBand.position.y = 3.1;
    const lhTop = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.95, 14), new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6 })); lhTop.position.y = 6.0;
    const lhLantern = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.95, 14), lampMat); lhLantern.position.y = 5.95;
    const lhCap = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.85, 14), new THREE.MeshStandardMaterial({ color: 0xc94f3d, roughness: 0.7 })); lhCap.position.y = 6.9;
    lh.add(lhBody, lhBand, lhTop, lhLantern, lhCap); lh.position.set(70, lhBaseY, lz); world.add(lh);
    addGlow(world, 70, lhBaseY + 5.9, lz, 0xffd58a, 7);
    const lhLight = new THREE.PointLight(0xffce8a, 0, 70); lhLight.position.set(70, lhBaseY + 6.3, lz); world.add(lhLight);

    // ---- lighthouse beam (hero moment) ----
    // A slim additive cone sweeps a seaward arc from the lamp, with a matching
    // streak on the water reading as its reflection, plus a real SpotLight. All
    // fade in with the day cycle and are carried by the bloom pass.
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

    // ---- pavilion (gazebo) ----
    const gx = -52, gz = 14, gy = sampleHeight(gx, gz);
    const pav = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.7, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0xb89a6e, roughness: 1 })); deck.position.y = 0.15; deck.receiveShadow = true; pav.add(deck);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.1, 6), postMat); post.position.set(Math.cos(a) * 2.2, 1.2, Math.sin(a) * 2.2); post.castShadow = true; pav.add(post); }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.3, 1.6, 6), new THREE.MeshStandardMaterial({ color: 0xc25245, roughness: 0.8 })); roof.position.y = 3.0; roof.castShadow = true; pav.add(roof);
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshStandardMaterial({ color: 0xf4b65a })); finial.position.y = 3.9; pav.add(finial);
    pav.position.set(gx, gy, gz); world.add(pav);

    // ---- white buildings cluster ----
    const winMat = new THREE.MeshStandardMaterial({ color: 0xfff0cf, emissive: new THREE.Color(0xffd27a), emissiveIntensity: 0 });
    windowMats.push(winMat);
    const bSpots: Array<[number, number]> = [[96, -6], [103, -13], [92, -16], [108, -4], [99, -22]];
    bSpots.forEach((b, i) => {
      const x = b[0];
      const z = backZ(x) - 7 - i * 3; // step the cluster back behind the beach
      const gh = sampleHeight(x, z); const hh = 7 + Math.random() * 9, w = 2.2 + Math.random() * 1.4;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, w), new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.85 }));
      m.position.set(x, gh + hh / 2, z); m.castShadow = true; m.receiveShadow = true; world.add(m);
      const win = new THREE.Mesh(new THREE.BoxGeometry(w * 0.72, hh * 0.78, w * 0.72), winMat); win.position.set(x, gh + hh / 2, z); world.add(win);
      addGlow(world, x, gh + hh * 0.6, z + w * 0.5, 0xffcf8a, 2.2);
    });

    // ---- residential roads (draped ribbons) ----
    const roadMat = new THREE.MeshStandardMaterial({ color: 0xc7bca6, roughness: 1 });
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
    [-56, -22, 12, 44, 74].forEach((x) => { const b = backZ(x); mkRoad([[x, b - 2], [x + 1, b - 16], [x + 2, b - 30]], 2.0); });

    // ---- houses (seaside residential) ----
    const housePal = [0xede6d6, 0xf2ddc6, 0xe6c9a8, 0xd2dbd4, 0xe9e3d1, 0xdcc9b0, 0xcdb79c];
    const roofPal = [0xb5503f, 0xc25245, 0x8a5a44, 0x6f7d74, 0x9a6b4f, 0x566a64, 0x7a4a3a];
    const mkHouse = (x: number, hgy: number, z: number, rot: number) => {
      const g = new THREE.Group();
      const bw = 2.2 + Math.random() * 1.5, bd = 2.0 + Math.random() * 1.3, bh = 1.6 + Math.random() * 1.0;
      const body = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), new THREE.MeshStandardMaterial({ color: housePal[(Math.random() * housePal.length) | 0], roughness: 0.9 }));
      body.position.y = bh / 2; body.castShadow = body.receiveShadow = true; g.add(body);
      const rh = 1.0 + Math.random() * 0.6;
      const hroof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(bw, bd) * 0.8, rh, 4), new THREE.MeshStandardMaterial({ color: roofPal[(Math.random() * roofPal.length) | 0], roughness: 0.85, flatShading: true }));
      hroof.rotation.y = Math.PI / 4; hroof.scale.set(bw / Math.max(bw, bd), 1, bd / Math.max(bw, bd)); hroof.position.y = bh + rh / 2; hroof.castShadow = true; g.add(hroof);
      const win = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.66, bh * 0.55, bd * 0.66), winMat); win.position.y = bh * 0.5; g.add(win);
      g.position.set(x, hgy - 0.15, z); g.rotation.y = rot; world.add(g);
      addGlow(world, x, hgy + bh * 0.55, z, 0xffd49a, 1.5);
    };
    const crossX = [-56, -22, 12, 44, 74];
    const onRoad = (x: number, z: number, bz: number) => {
      if (Math.abs(z - (bz - 4)) < 3.4) return true;    // coast road (just behind beach)
      if (Math.abs(z - (bz - 20)) < 3.4) return true;   // inland road
      for (const c of crossX) { const cb = backZ(c); if (z > cb - 32 && z < cb && Math.abs(x - (c + 1)) < 3.4) return true; }
      return false;
    };
    const houseSpots: Array<[number, number, number]> = [];
    for (let i = 0; i < 9000 && houseSpots.length < 50; i++) {
      const x = -76 + Math.random() * 166;
      const bz = backZ(x);
      const z = bz - 3 - Math.random() * 38; // behind the beach, spread inland
      const h = sampleHeight(x, z); if (h < 1.4 || h > 17) continue;
      const sl = Math.abs(sampleHeight(x + 2, z) - sampleHeight(x - 2, z)) + Math.abs(sampleHeight(x, z + 2) - sampleHeight(x, z - 2));
      if (sl > 4.5) continue;
      if (onRoad(x, z, bz)) continue;
      if (houseSpots.some((s) => Math.hypot(s[0] - x, s[1] - z) < 8.2)) continue;
      houseSpots.push([x, z, h]);
    }
    houseSpots.forEach(([x, z, h]) => mkHouse(x, h, z, (Math.random() - 0.5) * 0.5));

    // ===================== BEACH PROPS (shacks, lifeguard towers, benches, umbrellas) =====================
    // Find a point on the dry sand at column x: walk inland from the waterline
    // until the sand has risen `rise` above the water, then sit on that height.
    const beachPoint = (x: number, rise: number) => {
      const sz = shoreZ(x);
      for (let d = 0; d < 34; d += 1) { const z = sz - d; const y = sampleHeight(x, z); if (y > rise) return new THREE.Vector3(x, y, z); }
      const z = sz - 8; return new THREE.Vector3(x, sampleHeight(x, z), z);
    };
    // Skip the marina pier (x≈-36) and lighthouse point (x≈70).
    const occupied = (x: number) => Math.abs(x + 36) < 9 || Math.abs(x - 70) < 8;

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
      g.position.copy(p); g.rotation.y = Math.random() * 0.4 - 0.2; world.add(g);
    };

    const mkShack = (p: THREE.Vector3, hue: number) => {
      const g = new THREE.Group();
      const wallMat = new THREE.MeshStandardMaterial({ color: hue, roughness: 0.85 });
      const roofMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ec, roughness: 0.8 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.0, 2.6), wallMat); body.position.y = 1.0; body.castShadow = body.receiveShadow = true; g.add(body);
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 2.5, 0.8, 4), roofMat); roof.rotation.y = Math.PI / 4; roof.position.y = 2.4; roof.castShadow = true; g.add(roof);
      const awn = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.1, 1.1), roofMat); awn.position.set(0, 1.7, 1.7); awn.rotation.x = -0.28; awn.castShadow = true; g.add(awn);
      for (const ax of [-1.4, 1.4]) { const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 5), wallMat); arm.position.set(ax, 1.35, 2.05); arm.rotation.x = Math.PI / 2.2; g.add(arm); }
      g.position.copy(p); g.rotation.y = Math.random() * 0.6 - 0.3; world.add(g);
    };

    const benchSeatMat = new THREE.MeshStandardMaterial({ color: 0x9c7b4f, roughness: 0.9 });
    const benchLegMat = new THREE.MeshStandardMaterial({ color: 0x394049, roughness: 0.7 });
    const mkBench = (p: THREE.Vector3) => {
      const g = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.55), benchSeatMat); seat.position.y = 0.5; seat.castShadow = true; g.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.1), benchSeatMat); back.position.set(0, 0.78, -0.22); back.castShadow = true; g.add(back);
      for (const lx of [-0.75, 0.75]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.5), benchLegMat); leg.position.set(lx, 0.25, 0); leg.castShadow = true; g.add(leg); }
      g.position.copy(p); g.rotation.y = Math.PI + (Math.random() * 0.4 - 0.2); world.add(g); // face the sea
    };

    const mkUmbrella = (p: THREE.Vector3, hue: number) => {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0xece7dd, roughness: 0.8 })); pole.position.y = 1.1; g.add(pole);
      const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.7, 10), new THREE.MeshStandardMaterial({ color: hue, roughness: 0.7, side: THREE.DoubleSide })); canopy.position.y = 2.3; canopy.castShadow = true; g.add(canopy);
      g.position.copy(p); g.rotation.y = Math.random() * Math.PI; g.rotation.z = (Math.random() - 0.5) * 0.18; world.add(g);
    };

    const umbHues = [0xe24b3a, 0xf4b65a, 0x3f8fb0, 0xe7e3da, 0xd98344, 0x6fae8e];
    const shackHues = [0xe7e3da, 0xf2d6a8, 0xcfe0e6, 0xe9c7b0];
    [-60, -8, 30, 86].forEach((x) => { if (!occupied(x)) mkLifeguard(beachPoint(x, 0.3)); });
    [-66, -20, 16, 52].forEach((x, i) => { if (!occupied(x)) mkShack(beachPoint(x, 0.9), shackHues[i % shackHues.length]); });
    for (let x = -70; x <= 90; x += 11) { if (!occupied(x)) mkBench(beachPoint(x, 0.6)); }
    for (let i = 0; i < 28; i++) { const x = -70 + Math.random() * 160; if (occupied(x)) continue; mkUmbrella(beachPoint(x, 0.2 + Math.random() * 0.6), umbHues[(Math.random() * umbHues.length) | 0]); }

    // ---- hotspot anchors ----
    const anchors: Record<HotspotKey, THREE.Vector3> = {
      marina: new THREE.Vector3(-36, 4, pz + 6),
      lighthouse: new THREE.Vector3(70, 9, lz),
      promenade: new THREE.Vector3(12, sampleHeight(12, shoreZ(12) - 5) + 3, shoreZ(12) - 5),
      grove: new THREE.Vector3(gx, gy + 4.6, gz),
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

    // Dev helper: press "L" to print the current camera + target as paste-ready
    // Vector3 literals, for hand-tuning the TOP_POS / SIDE_POS framings. (Hit
    // "Explore the map" first so OrbitControls is enabled and you can fly around.)
    const onKeyLog = (e: KeyboardEvent) => {
      if (e.key !== 'l' && e.key !== 'L') return;
      const p = camera.position, t = controls.target;
      const f = (v: THREE.Vector3) => `new THREE.Vector3(${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})`;
      console.log(`POS    ${f(p)}\nTARGET ${f(t)}\n(dist ${p.distanceTo(t).toFixed(1)})`);
    };
    window.addEventListener('keydown', onKeyLog);

    // ===================== ANIMATE =====================
    const clock = new THREE.Clock();
    const tmpV = new THREE.Vector3();
    const sunVec = new THREE.Vector3();
    const moonVec = new THREE.Vector3();
    const wWhite = new THREE.Color(0xffffff);

    const animate = () => {
      if (!mounted) return;
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const et = clock.elapsedTime;

      // ocean: gentle vertex swell + shader-driven foam/depth tracking the day cycle
      const wpos = ocean.geometry.attributes.position as THREE.BufferAttribute;
      const warr = wpos.array as Float32Array;
      for (let i = 0; i < wpos.count; i++) { const ix = i * 3; const x = waterBase[ix], z = waterBase[ix + 2]; warr[ix + 1] = Math.sin(x * 0.05 + et * 0.9) * 0.12 + Math.cos(z * 0.06 + et * 0.7) * 0.12; }
      wpos.needsUpdate = true; ocean.geometry.computeVertexNormals();
      oceanUniforms.uTime.value = et;
      oceanUniforms.uShallow.value.copy(cur.water).lerp(wWhite, 0.25);
      oceanUniforms.uDeep.value.copy(cur.water).multiplyScalar(0.7);

      // moving boats
      movingBoats.forEach((b) => {
        const a = et * b.sp + b.ph;
        const x = b.cx + Math.cos(a) * b.rx, z = b.cz + Math.sin(a) * b.rz;
        const x2 = b.cx + Math.cos(a + 0.04) * b.rx, z2 = b.cz + Math.sin(a + 0.04) * b.rz;
        b.m.position.set(x, 0.7 + Math.sin(et * 1.5 + b.ph) * 0.06, z);
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
      sun.position.copy(keyVec).multiplyScalar(200);
      sun.color.copy(cur.keyCol);
      sun.intensity = cur.keyI;

      // ---- apply the sampled palette ----
      root.style.background = 'linear-gradient(180deg,' + cur.sky0.getStyle() + ' 0%,' + cur.sky1.getStyle() + ' 76%)';
      hemi.color.copy(cur.hemiSky); hemi.groundColor.copy(cur.hemiGround); hemi.intensity = cur.hemiI;
      scene.fog!.color.copy(cur.fog);
      lampMats.forEach((m) => (m.emissiveIntensity = cur.lamps * 1.4));
      windowMats.forEach((m) => (m.emissiveIntensity = cur.lamps * 1.1));
      glowSprites.forEach((m) => (m.opacity = cur.lamps * 0.9));
      starMat.opacity = cur.stars;
      lhLight.intensity = cur.lamps * 2.6;
      // sweep the lighthouse beam across the bay and fade it with the day cycle
      const beamSweep = 0.3 + Math.sin(et * 0.3) * 0.7;
      beamPivot.rotation.y = beamSweep;
      streakPivot.rotation.y = beamSweep;
      beamMat.opacity = cur.lamps * 0.7;
      streakMat.opacity = cur.lamps * 0.85;
      lhSpot.intensity = cur.lamps * 2.4;
      sunSprite.position.copy(sunVec).multiplyScalar(760);
      sunSprite.material.color.copy(cur.keyCol);
      sunSprite.material.opacity = cur.sunGlow;
      moonSprite.position.copy(moonVec).multiplyScalar(760);
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
      window.removeEventListener('keydown', onKeyLog);
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
    if (anchorsRef.current) focusTargetRef.current = anchorsRef.current[key].clone();
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
