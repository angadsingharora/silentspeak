import { LIP_DIMS } from "./motion";

/**
 * Which face blendshapes become lip channels, in order. Left/right pairs are averaged
 * so turning the head a little doesn't change the vector. Keep LIP_DIMS in sync.
 */
export const LIP_CHANNELS: readonly (readonly string[])[] = [
  ["jawOpen"],
  ["mouthClose"],
  ["mouthFunnel"],
  ["mouthPucker"],
  ["mouthSmileLeft", "mouthSmileRight"],
  ["mouthFrownLeft", "mouthFrownRight"],
  ["mouthStretchLeft", "mouthStretchRight"],
  ["mouthPressLeft", "mouthPressRight"],
  ["mouthRollLower"],
  ["mouthRollUpper"],
  ["mouthShrugLower"],
  ["mouthShrugUpper"],
  ["mouthLowerDownLeft", "mouthLowerDownRight"],
  ["mouthUpperUpLeft", "mouthUpperUpRight"],
  ["cheekPuff"],
  ["jawForward"],
];

if (LIP_CHANNELS.length !== LIP_DIMS) throw new Error("LIP_CHANNELS and LIP_DIMS disagree");

export interface Blendshape {
  categoryName: string;
  score: number;
}

/** Lip vector from a frame's blendshapes. Missing categories read as 0. */
export function lipVector(blendshapes: readonly Blendshape[]): number[] {
  const byName = new Map<string, number>();
  for (const b of blendshapes) byName.set(b.categoryName, b.score);
  return LIP_CHANNELS.map((names) => {
    let sum = 0;
    for (const n of names) sum += byName.get(n) ?? 0;
    return sum / names.length;
  });
}

/** How fast the mouth is moving: distance between consecutive lip vectors per second. */
export function lipSpeed(previous: number[], current: number[], dt: number): number {
  if (dt <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < Math.min(previous.length, current.length); i++) {
    const d = current[i] - previous[i];
    sum += d * d;
  }
  return Math.sqrt(sum) / dt;
}

export const GATE = {
  /** Mouth speed (blendshape units per second) that counts as moving. */
  threshold: 1.2,
  /** Seconds the mouth must move before a segment opens. */
  onSeconds: 0.08,
  /** Seconds of stillness that close a segment. */
  hangover: 0.4,
  /** A segment can't run longer than this. */
  maxSeconds: 4,
  /** Smoothing on the speed signal. */
  alpha: 0.5,
};

/**
 * Turns the mouth-speed signal into open/close events with hysteresis: open after a
 * short burst of movement, close after a pause. Drives capture when the camera is on.
 */
export class MouthGate {
  threshold = GATE.threshold;
  isOpen = false;
  speed = 0;
  onStart: (() => void) | null = null;
  onStop: (() => void) | null = null;

  private previous: number[] | null = null;
  private previousT = 0;
  private movingSince: number | null = null;
  private stillSince: number | null = null;
  private openedAt = 0;

  reset(): void {
    this.previous = null;
    this.movingSince = null;
    this.stillSince = null;
    if (this.isOpen) this.close();
  }

  ingest(lips: number[], t: number): void {
    if (this.previous) {
      const raw = lipSpeed(this.previous, lips, t - this.previousT);
      this.speed = this.speed * (1 - GATE.alpha) + raw * GATE.alpha;
    }
    this.previous = lips;
    this.previousT = t;

    const moving = this.speed > this.threshold;
    const still = this.speed < this.threshold * 0.5;

    if (!this.isOpen) {
      if (moving) {
        this.movingSince ??= t;
        if (t - this.movingSince >= GATE.onSeconds) this.open(t);
      } else {
        this.movingSince = null;
      }
      return;
    }

    if (still) {
      this.stillSince ??= t;
      if (t - this.stillSince >= GATE.hangover) this.close();
    } else {
      this.stillSince = null;
    }
    if (this.isOpen && t - this.openedAt > GATE.maxSeconds) this.close();
  }

  private open(t: number): void {
    this.isOpen = true;
    this.openedAt = t;
    this.movingSince = null;
    this.stillSince = null;
    this.onStart?.();
  }

  private close(): void {
    this.isOpen = false;
    this.movingSince = null;
    this.stillSince = null;
    this.onStop?.();
  }
}
