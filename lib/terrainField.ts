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

// ===================== RIVER + LAKE (Cascade Falls) =====================
// Source in the mountains -> waterfall -> alpine lake -> river -> sea. The
// centreline wanders with z; the carve below only ever lowers the land.
export const riverCenterX = (z: number) => 6 * Math.sin((z + 30) * 0.016) + 4 * Math.sin((z + 120) * 0.006) + 3;

// river/lake stations (z increases toward the sea). RIVER_SEA reaches past the
// wide sand band so the delta channel actually meets the ocean.
export const FALLS_TOP = -100;
export const FALLS_BOT = -88;
export const LAKE_OUT = -56;
export const RIVER_SEA = 52;
const DELTA_Z = 20; // where the mouth starts fanning across the beach

export const LAKE_CZ = -72;
export const LAKE_CX = riverCenterX(LAKE_CZ);
export const LAKE_R = 20;
export const lakeRad = (a: number) => LAKE_R * (0.82 + 0.26 * Math.sin(a * 3 + 1) + 0.14 * Math.sin(a * 5));
// <1 = inside the irregular lake (wider across the valley than along it)
export const lakeShape = (x: number, z: number) => {
  const a = Math.atan2(z - LAKE_CZ, x - LAKE_CX);
  return Math.hypot(x - LAKE_CX, (z - LAKE_CZ) * 0.92) / lakeRad(a);
};
// lake sits at the natural grade of its outlet spillway
export const LAKE_Y = landHeight(riverCenterX(LAKE_OUT), LAKE_OUT) - 0.6;

export const riverHalfW = (z: number) => {
  if (z <= FALLS_BOT && z > FALLS_TOP - 2) return 5.0;  // broad waterfall face
  if (z > FALLS_BOT && z < LAKE_OUT) return 5.5;        // through the lake (mostly hidden by the lake mesh)
  let w = 2.4;
  if (z > LAKE_OUT) w = 2.8 + (z - LAKE_OUT) * 0.012;
  if (z > DELTA_Z) w += (z - DELTA_Z) * 0.2;            // fan into a delta at the mouth
  return w;
};

// Strictly-downhill water profile = running minimum of the NATURAL ground along
// the centreline (toward the sea, z increases). This never raises land; the
// channel just gets cut deeper where the ground dips below the water line.
const _pz0 = -150, _pz1 = RIVER_SEA, _pn = 190;
const _prof: number[] = [];
{ let run = Infinity; for (let i = 0; i <= _pn; i++) { const z = _pz0 + (_pz1 - _pz0) * i / _pn; run = Math.min(run, landHeight(riverCenterX(z), z)); _prof.push(run); } }
const profAt = (z: number) => {
  if (z <= _pz0) return _prof[0];
  if (z >= _pz1) return _prof[_pn];
  const f = (z - _pz0) / (_pz1 - _pz0) * _pn, i = Math.floor(f), t = f - i;
  return _prof[i] * (1 - t) + _prof[i + 1] * t;
};

// Unified water surface: mountain stream -> waterfall -> flat lake -> outlet
// river -> sea (each segment hands off at the same height).
export const wlev = (z: number) => {
  if (z <= FALLS_TOP) return Math.max(profAt(z), LAKE_Y);                     // mountain stream on the natural grade
  if (z <= FALLS_BOT) return LAKE_Y + (Math.max(profAt(FALLS_TOP), LAKE_Y) - LAKE_Y) * ((FALLS_BOT - z) / (FALLS_BOT - FALLS_TOP)); // waterfall drop
  if (z <= LAKE_OUT) return LAKE_Y;                                           // flat lake
  const tt = (z - LAKE_OUT) / (14 - LAKE_OUT);                                // outlet drops to sea level, then tucks under the ocean
  return Math.max(LAKE_Y * (1 - tt), -0.3);
};

const carveRiver = (x: number, z: number, h: number) => {
  let out = h;
  // lake basin shaped as a BOWL: deep in the middle, rising to the waterline
  // at the shore (no floating rim)
  const lf = lakeShape(x, z);
  if (lf < 1.2) { const dep = Math.max(0, 1 - lf); const target = LAKE_Y - 4.6 * dep; const blend = sstep(1.2, 0.9, lf); out = Math.min(out, out * (1 - blend) + target * blend); }
  // narrow channel: mountain stream, waterfall, outlet river (only ever cut
  // down; shallow delta at the mouth)
  if (z >= FALLS_TOP - 4 && z <= RIVER_SEA + 6) {
    const cx = riverCenterX(z), d = Math.abs(x - cx), hw = riverHalfW(z), outer = hw + 9;
    if (d <= outer) {
      const deep = (z > FALLS_BOT && z < LAKE_OUT) ? 5 : (z > DELTA_Z ? 0.5 : 1.3);
      const floor = wlev(z) - deep;
      const blend = sstep(outer, hw, d);
      out = Math.min(out, out * (1 - blend) + floor * blend);
    }
  }
  return out;
};

export const nearRiver = (x: number, z: number) => {
  if (lakeShape(x, z) < 1.25) return true;
  if (z < FALLS_TOP - 2 || z > RIVER_SEA + 2) return false;
  return Math.abs(x - riverCenterX(z)) < riverHalfW(z) + 4.5;
};

// Long sandy beach: inland land ramps gently down across a wide sand flat to
// the waterline (a real beach, not a cliff), then a shallow underwater slope
// runs out to the deep seabed. BEACH widens/narrows the dry sand band.
export const BEACH = 26;   // beach width in oceanField units (bigger = longer beach)
const SEAW = 30;    // underwater slope width out to deep water
const WLINE = -0.35; // sand height at the waterline (just under the ocean surface)

export const sampleHeight = (x: number, z: number) => {
  const o = oceanField(x, z);
  if (o <= -BEACH) return carveRiver(x, z, landHeight(x, z));                  // inland
  if (o < 0) { const tb = sstep(-BEACH, 0, o); return carveRiver(x, z, lerp(Math.max(landHeight(x, z), 1.6), WLINE, tb)); } // dry sand (the delta cuts through)
  const td = sstep(0, SEAW, o); return lerp(WLINE, -13, td);                  // submerged slope
};

export const shoreZ = (x: number) => { for (let z = 210; z > -70; z -= 2) { if (oceanField(x, z) < 0) return z; } return 0; };

// z at the back of the beach (where the sand meets grass) for column x.
// Anything that shouldn't sit on the sand — roads, houses, apartments, the
// lighthouse — is anchored behind this line rather than behind the waterline.
export const backZ = (x: number) => { let z = shoreZ(x); for (let i = 0; i < 90 && oceanField(x, z) > -BEACH; i++) z -= 1; return z; };
