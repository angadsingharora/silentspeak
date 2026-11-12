/** One processed headphone-motion reading. `t` is seconds on the bridge's monotonic clock. */
export interface MotionSample {
  t: number;
  /** User acceleration (g), gravity removed. */
  ax: number; ay: number; az: number;
  /** Rotation rate (rad/s). */
  rx: number; ry: number; rz: number;
  /** Attitude (rad). */
  pitch: number; roll: number; yaw: number;
  /** Gravity vector (g). */
  gx: number; gy: number; gz: number;
}

export function makeSample(
  t: number,
  rotation: [number, number, number] = [0, 0, 0],
  accel: [number, number, number] = [0, 0, 0],
  attitude: [number, number, number] = [0, 0, 0],
): MotionSample {
  return {
    t,
    ax: accel[0], ay: accel[1], az: accel[2],
    rx: rotation[0], ry: rotation[1], rz: rotation[2],
    pitch: attitude[0], roll: attitude[1], yaw: attitude[2],
    gx: 0, gy: 0, gz: -1,
  };
}

/** Decodes the bridge's compact `motion` message array. */
export function sampleFromWire(s: number[]): MotionSample {
  return {
    t: s[0],
    ax: s[1], ay: s[2], az: s[3],
    rx: s[4], ry: s[5], rz: s[6],
    pitch: s[7], roll: s[8], yaw: s[9],
    gx: s[10] ?? 0, gy: s[11] ?? 0, gz: s[12] ?? -1,
  };
}

/** Which motion channels feed the classifier. Toggling these is the ablation experiment. */
export const Feature = {
  acceleration: 1 << 0,
  rotation: 1 << 1,
  attitude: 1 << 2,
} as const;

export type FeatureSet = number;
export const ALL_FEATURES: FeatureSet = Feature.acceleration | Feature.rotation | Feature.attitude;

export function featureNames(set: FeatureSet): string[] {
  const names: string[] = [];
  if (set & Feature.acceleration) names.push("acceleration");
  if (set & Feature.rotation) names.push("rotation");
  if (set & Feature.attitude) names.push("attitude");
  return names;
}

/**
 * Activity score used for segmentation. Rotation (rad/s) and acceleration (g) live on
 * different scales; the 5× weight puts typical jaw-motion values in the same range.
 */
export function energy(s: MotionSample): number {
  const rotation = Math.sqrt(s.rx * s.rx + s.ry * s.ry + s.rz * s.rz);
  const accel = Math.sqrt(s.ax * s.ax + s.ay * s.ay + s.az * s.az);
  return rotation + 5 * accel;
}

/** Drops quiet lead-in/lead-out frames so templates align on the articulation itself. */
export function trim(samples: MotionSample[], padding = 2): MotionSample[] {
  if (samples.length <= 6) return samples;
  const energies = samples.map(energy);
  const sorted = [...energies].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length / 5)];
  const peak = sorted[sorted.length - 1];
  if (!(peak > floor * 1.5)) return samples;
  const threshold = floor + 0.15 * (peak - floor);
  const first = energies.findIndex((e) => e > threshold);
  let last = -1;
  for (let i = energies.length - 1; i >= 0; i--) {
    if (energies[i] > threshold) { last = i; break; }
  }
  if (first < 0 || last < 0) return samples;
  const lo = Math.max(0, first - padding);
  const hi = Math.min(samples.length - 1, last + padding);
  if (hi - lo + 1 < 5) return samples;
  return samples.slice(lo, hi + 1);
}

function wrapped(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** Per-frame feature vectors, mean-centred per channel (removes posture/heading bias). */
export function frames(samples: MotionSample[], set: FeatureSet): number[][] {
  if (samples.length === 0) return [];
  const origin = samples[0];
  const out = samples.map((s) => {
    const v: number[] = [];
    if (set & Feature.acceleration) v.push(s.ax, s.ay, s.az);
    if (set & Feature.rotation) v.push(s.rx, s.ry, s.rz);
    if (set & Feature.attitude) {
      v.push(wrapped(s.pitch - origin.pitch), wrapped(s.roll - origin.roll), wrapped(s.yaw - origin.yaw));
    }
    return v;
  });
  const dims = out[0].length;
  for (let d = 0; d < dims; d++) {
    let mean = 0;
    for (const f of out) mean += f[d];
    mean /= out.length;
    for (const f of out) f[d] -= mean;
  }
  return out;
}

/** Per-channel standard deviation across a corpus, so no channel dominates the distance. */
export function channelScales(sequences: number[][][]): number[] {
  const dims = sequences[0]?.[0]?.length ?? 0;
  if (dims === 0) return [];
  const sum = new Array<number>(dims).fill(0);
  const sumSq = new Array<number>(dims).fill(0);
  let n = 0;
  for (const seq of sequences) {
    for (const f of seq) {
      for (let d = 0; d < dims; d++) {
        sum[d] += f[d];
        sumSq[d] += f[d] * f[d];
      }
      n++;
    }
  }
  if (n <= 1) return new Array<number>(dims).fill(1);
  return sum.map((s, d) => {
    const mean = s / n;
    return Math.max(Math.sqrt(Math.max(sumSq[d] / n - mean * mean, 0)), 1e-6);
  });
}

export function scaled(fr: number[][], scales: number[]): number[][] {
  return fr.map((f) => f.map((v, d) => v / scales[d]));
}
