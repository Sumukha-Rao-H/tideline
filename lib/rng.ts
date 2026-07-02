// Deterministic PRNG (mulberry32). The whole scene is built from one fixed
// seed, so every tree, rock, house and umbrella lands in exactly the same
// spot on every load — nothing in the world uses Math.random().
export type Rng = () => number;

export const SCENE_SEED = 1337;

export const createRng = (seed: number): Rng => {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
