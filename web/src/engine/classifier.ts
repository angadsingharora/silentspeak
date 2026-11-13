import { augmentations, type AugmentOptions } from "./augment";
import { dtwDistance } from "./dtw";
import { channelScales, frames, motionDims, scaled, trim, type FeatureSet, type MotionSample } from "./motion";

export interface Template {
  id: string;
  label: string;
  samples: MotionSample[];
  /** ISO 8601. */
  createdAt: string;
}

export function templateDuration(t: Template): number {
  if (t.samples.length < 2) return 0;
  return t.samples[t.samples.length - 1].t - t.samples[0].t;
}

export interface RankedLabel {
  label: string;
  /** DTW distance to this word's closest take. */
  distance: number;
  /** Share of the distance-weighted neighbour vote (0…1; shares sum to 1). */
  score: number;
}

export interface Prediction {
  ranked: RankedLabel[];
  /** 0…1 margin between the best and runner-up vote share. */
  confidence: number;
  accepted: boolean;
}

export interface Neighbour {
  label: string;
  distance: number;
}

/**
 * Distance-weighted vote over the `k` globally nearest takes, always including each
 * word's own closest take so the runner-up is never missing from the comparison.
 */
export function vote(neighbours: Neighbour[], k: number): RankedLabel[] {
  if (neighbours.length === 0) return [];
  const finite = neighbours.filter((n) => Number.isFinite(n.distance));
  if (finite.length === 0) {
    const labels = [...new Set(neighbours.map((n) => n.label))].sort();
    return labels.map((label) => ({ label, distance: Infinity, score: 1 / labels.length }));
  }
  const sorted = [...finite].sort((a, b) => a.distance - b.distance);

  const closest = new Map<string, number>();
  for (const n of sorted) if (!closest.has(n.label)) closest.set(n.label, n.distance);

  const pool = sorted.slice(0, Math.max(k, 1));
  for (const [label, distance] of closest) {
    if (!pool.some((n) => n.label === label)) pool.push({ label, distance });
  }

  const weights = new Map<string, number>();
  for (const n of pool) weights.set(n.label, (weights.get(n.label) ?? 0) + 1 / Math.max(n.distance, 1e-6));
  let total = 0;
  for (const w of weights.values()) total += w;

  return [...closest]
    .map(([label, distance]) => ({ label, distance, score: (weights.get(label) ?? 0) / total }))
    .sort((a, b) => (a.score !== b.score ? b.score - a.score : a.distance - b.distance));
}

/** Margin between the top two vote shares. With one word there is nothing to beat, so 0. */
export function margin(ranked: RankedLabel[]): number {
  if (ranked.length < 2) return 0;
  return Math.max(0, Math.min(1, ranked[0].score - ranked[1].score));
}

/** Small-vocabulary recogniser: distance-weighted k-NN DTW against user-recorded templates. */
export class TemplateClassifier {
  readonly featureSet: FeatureSet;
  readonly labels: string[];
  private readonly entries: { label: string; frames: number[][] }[];
  private readonly scales: number[];
  /** Real recorded takes; the rest of `entries` are synthetic copies. */
  readonly templateCount: number;

  private constructor(featureSet: FeatureSet, entries: { label: string; frames: number[][] }[], scales: number[], templateCount: number) {
    this.featureSet = featureSet;
    this.entries = entries;
    this.scales = scales;
    this.templateCount = templateCount;
    this.labels = [...new Set(entries.map((e) => e.label))].sort();
  }

  /**
   * Returns null until there are takes for at least two words. With `augment`, each take
   * also gets synthetic copies (see augment.ts). Channel scales come from real takes only.
   */
  static build(templates: Template[], featureSet: FeatureSet, augment: AugmentOptions | null = null): TemplateClassifier | null {
    if (featureSet === 0) return null;
    if (new Set(templates.map((t) => t.label)).size < 2) return null;
    const raw = templates.map((t) => frames(trim(t.samples), featureSet));
    const scales = channelScales(raw);
    const entries = templates.map((t, i) => ({ label: t.label, frames: scaled(raw[i], scales) }));
    if (augment && augment.copies > 0) {
      templates.forEach((t, i) => {
        for (const copy of augmentations(raw[i], t.id, augment, motionDims(featureSet))) entries.push({ label: t.label, frames: scaled(copy, scales) });
      });
    }
    return new TemplateClassifier(featureSet, entries, scales, templates.length);
  }

  /** Real takes plus synthetic copies. */
  get entryCount(): number {
    return this.entries.length;
  }

  neighbours(samples: MotionSample[]): Neighbour[] {
    const query = scaled(frames(trim(samples), this.featureSet), this.scales);
    return this.entries.map((e) => ({ label: e.label, distance: dtwDistance(query, e.frames) }));
  }

  rank(samples: MotionSample[], k = 3): RankedLabel[] {
    return vote(this.neighbours(samples), k);
  }

  predict(samples: MotionSample[], opts: { k?: number; maxDistance: number; minConfidence: number }): Prediction {
    const ranked = this.rank(samples, opts.k ?? 3);
    const confidence = margin(ranked);
    const best = ranked[0]?.distance ?? Infinity;
    return { ranked, confidence, accepted: best <= opts.maxDistance && confidence >= opts.minConfidence };
  }
}
