import * as THREE from 'three';

export type TimeIdx = 0 | 1 | 2 | 3;

// A single moment in the day cycle. `keyCol`/`keyI` describe the dominant
// celestial light (sun by day, moon by night); `sunGlow`/`moonGlow` drive the
// two sky sprites independently.
export interface DayState {
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

export interface Keyframe extends DayState {
  at: number; // day fraction this keyframe is anchored to
}

export const TIME_LABELS = ['Morning', 'Afternoon', 'Evening', 'Night'] as const;

// ===================== CONTINUOUS DAY / NIGHT CYCLE =====================
// `day` is a normalised fraction in [0,1): 0 = midnight, 0.25 = sunrise (east),
// 0.5 = noon (overhead), 0.75 = sunset (west). The sun rides a tilted arc and
// the moon sits at the antipode; the palette and light levels are sampled from
// the keyframes below and interpolated, so the scene flows through the day
// instead of snapping between four fixed states.
export const TAU = Math.PI * 2;
export const DAY_STOPS = [0.3, 0.52, 0.76, 0.95]; // Morning, Afternoon, Evening, Night
export const AUTO_DAY_SPEED = 1 / 30; // full cycle ≈ 60s when auto-cycling

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const col = (h: string) => new THREE.Color(h);

// Unit direction toward the sun at a given day fraction (moon = antipode).
export const sunDirAt = (day: number, out: THREE.Vector3) => {
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

export const createDayState = (): DayState => ({
  sky0: new THREE.Color(), sky1: new THREE.Color(), fog: new THREE.Color(), water: new THREE.Color(),
  hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), keyCol: new THREE.Color(),
  hemiI: 0, keyI: 0, lamps: 0, stars: 0, sunGlow: 0, moonGlow: 0,
});

// Interpolate the keyframe ring into `out` for the given day fraction.
export const sampleDay = (day: number, out: DayState) => {
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
