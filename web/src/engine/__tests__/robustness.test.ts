import { describe, expect, it } from "vitest";
import { CaptureController, CAPTURE } from "../capture";
import { TemplateClassifier, vote, type Template } from "../classifier";
import { dtwDistance } from "../dtw";
import { evaluate } from "../evaluation";
import { ALL_FEATURES, Feature, frames, makeSample, trim, type MotionSample } from "../motion";
import { parseDataset } from "../dataset";

function rng(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noisyTake(random: () => number, n: number, scale = 0.1): MotionSample[] {
  return Array.from({ length: n }, (_, i) =>
    makeSample(i / 25, [random() * scale, random() * scale, random() * scale], [random() * 0.01, 0, 0], [random(), random(), random()]));
}

function tpl(label: string, samples: MotionSample[]): Template {
  return { id: crypto.randomUUID(), label, samples, createdAt: "" };
}

describe("degenerate inputs", () => {
  const random = rng(7);

  it("DTW handles empty, single-frame and mismatched dims", () => {
    expect(dtwDistance([], [[1]])).toBe(Infinity);
    expect(dtwDistance([[1]], [[2]])).toBeCloseTo(0.5);
    expect(Number.isFinite(dtwDistance([[1, 2, 3]], [[1, 2]]))).toBe(true);
    expect(Number.isFinite(dtwDistance([[0]], Array.from({ length: 500 }, () => [1])))).toBe(true);
  });

  it("frames/trim survive tiny and constant segments", () => {
    expect(frames([], ALL_FEATURES)).toEqual([]);
    expect(frames([makeSample(0)], ALL_FEATURES)[0]).toHaveLength(9);
    const flat = Array.from({ length: 40 }, (_, i) => makeSample(i / 25, [0.1, 0.1, 0.1]));
    expect(trim(flat)).toHaveLength(40);
    expect(trim([])).toEqual([]);
    expect(trim([makeSample(0)])).toHaveLength(1);
  });

  it("classifier never returns NaN, even for zero-variance training data", () => {
    const flat = Array.from({ length: 20 }, (_, i) => makeSample(i / 25, [0.1, 0, 0]));
    const templates = [tpl("a", flat), tpl("a", flat), tpl("b", flat), tpl("b", flat)];
    const c = TemplateClassifier.build(templates, ALL_FEATURES)!;
    const p = c.predict(flat, { maxDistance: 1, minConfidence: 0 });
    for (const r of p.ranked) {
      expect(Number.isNaN(r.score)).toBe(false);
      expect(Number.isNaN(r.distance)).toBe(false);
    }
    expect(Number.isNaN(p.confidence)).toBe(false);
    const e = evaluate(templates, { featureSet: ALL_FEATURES, permutations: 20 }, random);
    expect(e).not.toBeNull();
    expect(Number.isNaN(e!.pValue)).toBe(false);
  });

  it("predicts on a 1-frame and a 1000-frame query", () => {
    const templates = [tpl("a", noisyTake(random, 30)), tpl("a", noisyTake(random, 30)), tpl("b", noisyTake(random, 30, 1)), tpl("b", noisyTake(random, 30, 1))];
    const c = TemplateClassifier.build(templates, ALL_FEATURES)!;
    expect(c.predict([makeSample(0)], { maxDistance: 1, minConfidence: 0 }).ranked).toHaveLength(2);
    expect(c.predict(noisyTake(random, 1000), { maxDistance: 1, minConfidence: 0 }).ranked).toHaveLength(2);
  });

  it("vote with k larger than the pool and with NaN distances", () => {
    expect(vote([{ label: "a", distance: 1 }, { label: "b", distance: 2 }], 99)).toHaveLength(2);
    const ranked = vote([{ label: "a", distance: NaN }, { label: "b", distance: 1 }], 3);
    expect(ranked[0].label).toBe("b");
    expect(ranked.every((r) => !Number.isNaN(r.score))).toBe(true);
  });

  it("rejects NaN/Infinity-laden dataset samples", () => {
    expect(() => parseDataset({ vocabulary: ["x"], templates: [{ label: "x", samples: [{ t: 0, ax: "1" }] }] })).toThrow();
    const d = parseDataset({ vocabulary: ["x"], templates: [{ label: "x", samples: [{ t: 0, ax: 0, ay: 0, az: 0, rx: 0, ry: 0, rz: 0, pitch: 0, roll: 0, yaw: 0 }] }] });
    expect(d.templates[0].samples[0].gz).toBe(-1);
  });

  it("evaluate copes with many words and uneven counts", () => {
    const templates: Template[] = [];
    for (let w = 0; w < 12; w++) for (let i = 0; i < 2 + (w % 3); i++) templates.push(tpl(`w${w}`, noisyTake(random, 10 + w)));
    const e = evaluate(templates, { featureSet: Feature.rotation, permutations: 30 }, random)!;
    expect(e.labels).toHaveLength(12);
    expect(e.confusion.flat().reduce((a, b) => a + b, 0)).toBe(templates.length);
    expect(e.pValue).toBeGreaterThan(0);
    expect(e.pValue).toBeLessThanOrEqual(1);
  });
});

describe("capture controller edge cases", () => {
  it("ends a held capture at the max hold length and drops too-short ones", () => {
    const c = new CaptureController();
    const out: MotionSample[][] = [];
    c.onSegment = (s) => out.push(s);
    c.begin();
    for (let i = 0; i < 25 * (CAPTURE.maxHoldSeconds + 1); i++) c.ingest(makeSample(i / 25, [0.1, 0, 0]));
    expect(out).toHaveLength(1);
    expect(c.isCapturing).toBe(false);
    c.begin();
    c.ingest(makeSample(100, [0.1, 0, 0]));
    c.end();
    expect(out).toHaveLength(1);
  });

  it("ignores doubled begin/end and out-of-order timestamps", () => {
    const c = new CaptureController();
    const out: MotionSample[][] = [];
    c.onSegment = (s) => out.push(s);
    c.begin(); c.begin();
    for (let i = 0; i < 20; i++) c.ingest(makeSample(1 - i / 25, [0.1, 0, 0]));
    c.end(); c.end();
    expect(c.isCapturing).toBe(false);
    expect(out.length).toBeLessThanOrEqual(1);
  });

  it("auto mode never captures before calibration and handles energy spikes", () => {
    const c = new CaptureController();
    const out: MotionSample[][] = [];
    c.onSegment = (s) => out.push(s);
    c.setAutoEnabled(true);
    for (let i = 0; i < 100; i++) c.ingest(makeSample(i / 25, [10, 10, 10]));
    expect(out).toHaveLength(0);
    c.calibrate();
    for (let i = 100; i < 200; i++) c.ingest(makeSample(i / 25, [0.01, 0, 0]));
    for (let i = 200; i < 400; i++) c.ingest(makeSample(i / 25, [i % 50 < 10 ? 5 : 0.01, 0, 0]));
    expect(out.length).toBeGreaterThanOrEqual(3);
    for (const s of out) expect(s[s.length - 1].t - s[0].t).toBeLessThanOrEqual(CAPTURE.maxAutoSeconds + 0.1);
  });
});

describe("timing", () => {
  const random = rng(99);

  it("predicts against 200 takes in well under a frame budget", () => {
    const templates: Template[] = [];
    for (let w = 0; w < 10; w++) for (let i = 0; i < 20; i++) templates.push(tpl(`w${w}`, noisyTake(random, 25 + (i % 10))));
    const c = TemplateClassifier.build(templates, ALL_FEATURES)!;
    const query = noisyTake(random, 30);
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) c.predict(query, { maxDistance: 2, minConfidence: 0 });
    const ms = (performance.now() - t0) / 10;
    console.log(`predict vs 200 takes: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(200);
  });

  it("evaluates 60 takes with 500 permutations in reasonable time", () => {
    const templates: Template[] = [];
    for (let w = 0; w < 5; w++) for (let i = 0; i < 12; i++) templates.push(tpl(`w${w}`, noisyTake(random, 30)));
    const t0 = performance.now();
    const e = evaluate(templates, { featureSet: ALL_FEATURES, permutations: 500 }, random)!;
    const ms = performance.now() - t0;
    console.log(`evaluate 60 takes x 500 perms: ${ms.toFixed(0)} ms`);
    expect(e.templateCount).toBe(60);
    expect(ms).toBeLessThan(15000);
  });
});

describe("taps", () => {
  it("a key tap with no held samples records nothing", () => {
    const c = new CaptureController();
    const out: MotionSample[][] = [];
    c.onSegment = (s) => out.push(s);
    for (let i = 0; i < 25; i++) c.ingest(makeSample(i / 25, [0.2, 0, 0]));
    for (let i = 0; i < 50; i++) { c.begin(); c.end(); }
    expect(out).toHaveLength(0);
    c.begin();
    for (let i = 25; i < 40; i++) c.ingest(makeSample(i / 25, [0.2, 0, 0]));
    c.end();
    expect(out).toHaveLength(1);
  });
});
