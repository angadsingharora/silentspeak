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
  featureSet: FeatureSet;
}

export interface EvaluationOptions {
  featureSet: FeatureSet;
  k?: number;
  permutations?: number;
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
  const { featureSet, k = 3, permutations = 500, onProgress } = options;
  const labels = [...new Set(templates.map((t) => t.label))].sort();
  const counts = new Map<string, number>();
  for (const t of templates) counts.set(t.label, (counts.get(t.label) ?? 0) + 1);
  if (labels.length < 2 || featureSet === 0) return null;
  for (const c of counts.values()) if (c < 2) return null;

  const raw = templates.map((t) => frames(trim(t.samples), featureSet));
  const scales = channelScales(raw);
  const seqs = raw.map((r) => scaled(r, scales));
  const n = seqs.length;

  // Pairwise distances once; every labelling (true or permuted) reuses them.
  const distance: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = dtwDistance(seqs[i], seqs[j]);
      distance[i][j] = d;
      distance[j][i] = d;
    }
  }

  const index = new Map(labels.map((l, i) => [l, i]));
  const truth = templates.map((t) => index.get(t.label)!);

  const leaveOneOut = (assignment: number[]): number[] =>
    Array.from({ length: n }, (_, i) => {
      const neighbours: Neighbour[] = [];
      for (let j = 0; j < n; j++) {
        if (j !== i) neighbours.push({ label: labels[assignment[j]], distance: distance[i][j] });
      }
      return index.get(vote(neighbours, k)[0].label)!;
    });

  const accuracy = (predicted: number[], actual: number[]): number => {
    let hits = 0;
    for (let i = 0; i < n; i++) if (predicted[i] === actual[i]) hits++;
    return hits / n;
  };

  const predicted = leaveOneOut(truth);
  const confusion = labels.map(() => new Array<number>(labels.length).fill(0));
  predicted.forEach((p, i) => { confusion[truth[i]][p] += 1; });
  const observed = accuracy(predicted, truth);

  const nullAccuracies: number[] = [];
  for (let p = 0; p < permutations; p++) {
    const shuffled = shuffle(truth, random);
    nullAccuracies.push(accuracy(leaveOneOut(shuffled), shuffled));
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
  };
}
