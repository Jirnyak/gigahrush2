/* ── Tiny shared randomness utilities ─────────────────────────── */
/*   Use explicit seeded RNG for generation-time choices.          */
/*   Math.random helpers below are only for fresh runtime entropy. */

export type RandomSource = () => number;

/** Fast xorshift32 PRNG, bit-compatible with the timaert generator. */
export function xorshift32(seed: number): RandomSource {
  let s = (seed | 0) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export class SeedRng {
  private state: number;
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.state = (seed | 0) || 1;
  }

  nextU32(): number {
    let s = this.state;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.state = s;
    return s >>> 0;
  }

  random(): number {
    return this.nextU32() / 4294967296;
  }

  int(lo: number, hi: number): number {
    return lo + Math.floor(this.random() * (hi - lo + 1));
  }

  float(lo: number, hi: number): number {
    return lo + this.random() * (hi - lo);
  }

  chance(p: number): boolean {
    return this.random() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.random() * items.length)];
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}

/** Random non-negative integer seed in [0, 99999), suitable for
 *  decals, mark stamping and other procedural variation. */
export function randSeed(): number {
  return Math.floor(Math.random() * 99999);
}

/** Inclusive integer in [a, b]. */
export function irand(a: number, b: number): number {
  return a + Math.floor(Math.random() * (b - a + 1));
}

/** Inclusive integer in [a, b] from an explicit RNG. */
export function irandFrom(rand: RandomSource, a: number, b: number): number {
  return a + Math.floor(rand() * (b - a + 1));
}

export function pickFrom<T>(rand: RandomSource, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)];
}

export function shuffleWith<T>(rand: RandomSource, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Stable 32-bit hash for string ids and procedural route keys. */
export function hashSeed(text: string, seed = 0): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Tiny deterministic PRNG, suitable for generation-time choices. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Run Math.random-based generators under a local deterministic seed. */
export function withSeededRandom<T>(seed: number, fn: () => T): T {
  const oldRandom = Math.random;
  Math.random = xorshift32(seed);
  try {
    return fn();
  } finally {
    Math.random = oldRandom;
  }
}

/**
 * Returns a cryptographically secure random float in [0, 1).
 * Suitable for security-sensitive logic like quest assignment or secrets.
 */
export function secureRandom(): number {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return array[0] / 4294967296;
}
