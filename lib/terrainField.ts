import { lerp } from './dayCycle';

// ===================== TERRAIN FIELD FUNCTIONS =====================
// Pure functions of (x, z) — seeded value noise, the signed coast field, and
// the height/shoreline samplers every scene builder anchors against. The seed
// is fixed, so the terrain is identical on every load.
const seed = 21.7;

export const hash = (x: number, y: number) => { const n = Math.sin(x * 127.1 + y * 311.7 + seed) * 43758.5453; return n - Math.floor(n); };

const vnoise = (x: number, y: number) => {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
};

export const fbm = (x: number, y: number, oct = 5) => { let s = 0, a = 0.5, f = 1, m = 0; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); m += a; f *= 2; a *= 0.5; } return s / m; };

const ridged = (x: number, y: number, oct = 5) => { let s = 0, a = 0.5, f = 1, m = 0; for (let i = 0; i < oct; i++) { const n = 1 - Math.abs(vnoise(x * f, y * f) * 2 - 1); s += a * n * n; m += a; f *= 2; a *= 0.5; } return s / m; };

export const sstep = (a: number, b: number, x: number) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };

// Signed coast field: 0 at the waterline, negative inland, growing seaward.
export const oceanField = (x: number, z: number) => { const wig = (fbm(x * 0.004 + 10, z * 0.004 + 3, 4) - 0.5) * 34; return x * 0.5 + z * 0.95 - 58 + wig; };

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
export const BEACH = 26;   // beach width in oceanField units (bigger = longer beach)
const SEAW = 30;    // underwater slope width out to deep water
const WLINE = -0.35; // sand height at the waterline (just under the ocean surface)

export const sampleHeight = (x: number, z: number) => {
  const o = oceanField(x, z);
  if (o <= -BEACH) return landHeight(x, z);                                   // inland
  if (o < 0) { const tb = sstep(-BEACH, 0, o); return lerp(Math.max(landHeight(x, z), 1.6), WLINE, tb); } // dry sand
  const td = sstep(0, SEAW, o); return lerp(WLINE, -13, td);                  // submerged slope
};

export const shoreZ = (x: number) => { for (let z = 210; z > -70; z -= 2) { if (oceanField(x, z) < 0) return z; } return 0; };

// z at the back of the beach (where the sand meets grass) for column x.
// Anything that shouldn't sit on the sand — roads, houses, apartments, the
// lighthouse — is anchored behind this line rather than behind the waterline.
export const backZ = (x: number) => { let z = shoreZ(x); for (let i = 0; i < 90 && oceanField(x, z) > -BEACH; i++) z -= 1; return z; };
