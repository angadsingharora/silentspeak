import { augmentations, type AugmentOptions } from "./augment";
import { vote, type Neighbour, type Template } from "./classifier";
import { dtwDistance } from "./dtw";
import { channelScales, frames, scaled, trim, type FeatureSet } from "./motion";

export interface Evaluation {
  labels: string[];
  /** confusion[actual][predicted] */
  confusion: number[][];
  accuracy: number;
  /** Accuracy of always guessing the most common label. */
  chance: number;
  permutationMean: number;
  permutationP95: number;
  pValue: number;
  permutations: number;
  templateCount: number;
  k: number;
  /** Whether synthetic copies were in the training folds. */
  augmented: boolean;
  /** Leave-one-out accuracy on real takes only, for comparison. Null when not augmented. */
  baselineAccuracy: number | null;
  featureSet: FeatureSet;
}

export interface EvaluationOptions {
  featureSet: FeatureSet;
  k?: number;
  permutations?: number;
  /** Add synthetic copies of each training take. The held-out take's own copies are never used. */
  augment?: AugmentOptions | null;
  /** Called with 0…1 as the permutation test runs. */
  onProgress?: (fraction: number) => void;
}

function shuffle<T>(array: T[], random: () => number): T[] {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Leave-one-out accuracy plus a label-permutation test: the honest answer to
 * "is the motion stream statistically distinguishable between words?"
 */
export function evaluate(templates: Template[], options: EvaluationOptions, random: () => number = Math.random): Evaluation | null {
  const { featureSet, k = 3, permutations = 500, augment = null, onProgress } = options;
  const labels = [...new Set(templates.map((t) => t.label))].sort();
  const counts = new Map<string, number>();
  for (const t of templates) counts.set(t.label, (counts.get(t.label) ?? 0) + 1);
  if (labels.length < 2 || featureSet === 0) return null;
  for (const c of counts.values()) if (c < 2) return null;

  const raw = templates.map((t) => frames(trim(t.samples), featureSet));
  const scales = channelScales(raw);
  const seqs = raw.map((r) => scaled(r, scales));
  const n = seqs.length;

  // Training entries: the real takes, then any synthetic copies. `source[e]` is the real
  // take an entry came from, so a held-out take drops its own copies along with itself.
  const entries = [...seqs];
  const source = seqs.map((_, i) => i);
  const augmented = Boolean(augment && augment.copies > 0);
  if (augmented) {
    templates.forEach((t, i) => {
      for (const copy of augmentations(raw[i], t.id, augment!)) {
        entries.push(scaled(copy, scales));
        source.push(i);
      }
    });
  }

  // Distances from each real take to every entry, once; every labelling reuses them.
  const distance: number[][] = Array.from({ length: n }, () => new Array<number>(entries.length).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = dtwDistance(seqs[i], seqs[j]);
      distance[i][j] = d;
      distance[j][i] = d;
    }
    for (let e = n; e < entries.length; e++) {
      if (source[e] !== i) distance[i][e] = dtwDistance(seqs[i], entries[e]);
    }
  }

  // Each held-out take's usable entries, nearest first (vote re-sorts, which is cheap on sorted input).
  const order = (includeCopies: boolean) => Array.from({ length: n }, (_, i) => {
    const usable: number[] = [];
    const limit = includeCopies ? entries.length : n;
    for (let e = 0; e < limit; e++) if (source[e] !== i) usable.push(e);
    return usable.sort((a, b) => distance[i][a] - distance[i][b]);
  });

  const index = new Map(labels.map((l, i) => [l, i]));
  const truth = templates.map((t) => index.get(t.label)!);

  const leaveOneOut = (assignment: number[], rows: number[][]): number[] =>
    rows.map((usable, i) => {
      const neighbours: Neighbour[] = usable.map((e) => ({ label: labels[assignment[source[e]]], distance: distance[i][e] }));
      return index.get(vote(neighbours, k)[0].label)!;
    });
  const rows = order(augmented);

  const accuracy = (predicted: number[], actual: number[]): number => {
    let hits = 0;
    for (let i = 0; i < n; i++) if (predicted[i] === actual[i]) hits++;
    return hits / n;
  };

  const predicted = leaveOneOut(truth, rows);
  const confusion = labels.map(() => new Array<number>(labels.length).fill(0));
  predicted.forEach((p, i) => { confusion[truth[i]][p] += 1; });
  const observed = accuracy(predicted, truth);

  const nullAccuracies: number[] = [];
  for (let p = 0; p < permutations; p++) {
    const shuffled = shuffle(truth, random);
    nullAccuracies.push(accuracy(leaveOneOut(shuffled, rows), shuffled));
    if (onProgress && (p % 25 === 0 || p === permutations - 1)) onProgress((p + 1) / permutations);
  }
  nullAccuracies.sort((a, b) => a - b);
  const atLeast = nullAccuracies.filter((a) => a >= observed).length;

  return {
    labels,
    confusion,
    accuracy: observed,
    chance: Math.max(...counts.values()) / n,
    permutationMean: nullAccuracies.reduce((a, b) => a + b, 0) / Math.max(permutations, 1),
    permutationP95: nullAccuracies.length ? nullAccuracies[Math.floor((nullAccuracies.length - 1) * 0.95)] : 0,
    pValue: (atLeast + 1) / (permutations + 1),
    permutations,
    templateCount: n,
    k,
    featureSet,
    augmented,
    baselineAccuracy: augmented ? accuracy(leaveOneOut(truth, order(false)), truth) : null,
  };
}
