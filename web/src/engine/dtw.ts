/**
 * Dynamic time warping between two multichannel sequences, with a Sakoe–Chiba band.
 * Lets the same mouthed word match when said faster or slower.
 */
export function dtwDistance(a: number[][], b: number[][], bandFraction = 0.25): number {
  const n = a.length, m = b.length;
  if (n === 0 || m === 0) return Infinity;
  const band = Math.max(Math.abs(n - m), Math.floor(Math.max(n, m) * bandFraction));

  let previous = new Float64Array(m + 1).fill(Infinity);
  let current = new Float64Array(m + 1).fill(Infinity);
  previous[0] = 0;

  for (let i = 1; i <= n; i++) {
    current.fill(Infinity);
    const lo = Math.max(1, i - band);
    const hi = Math.min(m, i + band);
    const ai = a[i - 1];
    for (let j = lo; j <= hi; j++) {
      const bj = b[j - 1];
      let sum = 0;
      const dims = Math.min(ai.length, bj.length);
      for (let k = 0; k < dims; k++) {
        const d = ai[k] - bj[k];
        sum += d * d;
      }
      current[j] = Math.sqrt(sum) + Math.min(previous[j], current[j - 1], previous[j - 1]);
    }
    const tmp = previous; previous = current; current = tmp;
  }
  // Normalise by the maximum path length so long and short words compare fairly.
  return previous[m] / (n + m);
}
