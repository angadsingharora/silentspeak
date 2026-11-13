/**
 * Synthetic takes. Each real take gets a few perturbed copies so a word needs fewer
 * recordings. The perturbations copy the ways the same word really varies:
 *
 * - tilt: a small 3D rotation of the sensor axes, the way re-seating the AirPods changes them
 * - gain: mouthing a little bigger or smaller
 * - stretch: mouthing a little faster or slower
 * - noise: sensor jitter
 *
 * Copies are seeded from the take's id, so the same dataset always gives the same copies.
 */

export interface AugmentOptions {
  /** Synthetic copies per real take. */
  copies: number;
  /** Max fractional change in length, e.g. 0.15 → 85%…115%. */
  stretch: number;
  /** Max fractional change in amplitude. */
  gain: number;
  /** Max axis rotation in radians. */
  tilt: number;
  /** Noise std as a fraction of each channel's own std. */
  noise: number;
}

export const DEFAULT_AUGMENT: AugmentOptions = {
  copies: 4,
  stretch: 0.15,
  gain: 0.15,
  tilt: (8 * Math.PI) / 180,
  noise: 0.05,
};

export function seededRandom(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a, for turning a take id into a seed. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function uniform(random: () => number, spread: number): number {
  return (random() * 2 - 1) * spread;
}

function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/** Rotation by `angle` about a random axis (Rodrigues), as a row-major 3×3. */
function randomRotation(random: () => number, maxAngle: number): number[] {
  const z = random() * 2 - 1;
  const phi = random() * 2 * Math.PI;
  const r = Math.sqrt(1 - z * z);
  const [x, y] = [r * Math.cos(phi), r * Math.sin(phi)];
  const angle = uniform(random, maxAngle);
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}

function resample(fr: number[][], length: number): number[][] {
  if (fr.length < 2 || length === fr.length) return fr.map((f) => [...f]);
  const out: number[][] = [];
  for (let k = 0; k < length; k++) {
    const pos = (k * (fr.length - 1)) / Math.max(length - 1, 1);
    const i = Math.min(Math.floor(pos), fr.length - 2);
    const w = pos - i;
    out.push(fr[i].map((v, d) => v * (1 - w) + fr[i + 1][d] * w));
  }
  return out;
}

/**
 * One perturbed copy of a take's (unscaled, mean-centred) feature frames.
 * The first `tiltDims` dims come in groups of three axes (acceleration, rotation,
 * attitude) and every group gets the same tilt since they all come from the same
 * sensor. Dims after that (lip shapes) only get gain and noise.
 */
export function augmentFrames(fr: number[][], random: () => number, options: AugmentOptions = DEFAULT_AUGMENT, tiltDims = fr[0]?.length ?? 0): number[][] {
  if (fr.length === 0) return [];
  const dims = fr[0].length;

  const m = randomRotation(random, options.tilt);
  const gain = 1 + uniform(random, options.gain);
  let out = fr.map((f) => {
    const v = [...f];
    for (let g = 0; g + 2 < Math.min(tiltDims, dims); g += 3) {
      const [a, b, c] = [f[g], f[g + 1], f[g + 2]];
      v[g] = m[0] * a + m[1] * b + m[2] * c;
      v[g + 1] = m[3] * a + m[4] * b + m[5] * c;
      v[g + 2] = m[6] * a + m[7] * b + m[8] * c;
    }
    return v.map((x) => x * gain);
  });

  const length = Math.max(2, Math.round(fr.length * (1 + uniform(random, options.stretch))));
  out = resample(out, length);

  for (let d = 0; d < dims; d++) {
    let mean = 0, sq = 0;
    for (const f of out) { mean += f[d]; sq += f[d] * f[d]; }
    mean /= out.length;
    const std = Math.sqrt(Math.max(sq / out.length - mean * mean, 0));
    let centred = 0;
    for (const f of out) {
      f[d] += gaussian(random) * std * options.noise;
      centred += f[d];
    }
    centred /= out.length;
    for (const f of out) f[d] -= centred;
  }
  return out;
}

/** The synthetic copies for one take, reproducible from its id. */
export function augmentations(fr: number[][], id: string, options: AugmentOptions = DEFAULT_AUGMENT, tiltDims = fr[0]?.length ?? 0): number[][][] {
  const random = seededRandom(hashString(id));
  return Array.from({ length: options.copies }, () => augmentFrames(fr, random, options, tiltDims));
}
