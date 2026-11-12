import { describe, expect, it } from "vitest";
import { margin, TemplateClassifier, vote, type Template } from "../classifier";
import { dtwDistance } from "../dtw";
import { evaluate } from "../evaluation";
import { ALL_FEATURES, Feature, frames, makeSample, trim, type MotionSample } from "../motion";
import { CaptureController } from "../capture";

/** Deterministic PRNG so the tests don't flake. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(42);

/** A synthetic "word": a burst of rotation at `frequency` cycles over the segment. */
function take(frequency: number, axis: number, framesCount = 30, noise = 0.01): MotionSample[] {
  return Array.from({ length: framesCount }, (_, i) => {
    const envelope = Math.sin((Math.PI * i) / (framesCount - 1));
    const v = 0.2 * envelope * Math.sin((2 * Math.PI * frequency * i) / framesCount);
    const jitter = () => (random() * 2 - 1) * noise;
    const rotation: [number, number, number] = [jitter(), jitter(), jitter()];
    rotation[axis] += v;
    return makeSample(i / 25, rotation);
  });
}

function template(label: string, samples: MotionSample[]): Template {
  return { id: crypto.randomUUID(), label, samples, createdAt: new Date().toISOString() };
}

describe("DTW", () => {
  it("is zero for identical sequences and tolerant of warping", () => {
    const a = frames(take(2, 0, 30, 0), Feature.rotation);
    const stretched = frames(take(2, 0, 40, 0), Feature.rotation);
    const other = frames(take(2, 1, 30, 0), Feature.rotation);
    expect(dtwDistance(a, a)).toBe(0);
    expect(dtwDistance(a, stretched)).toBeLessThan(dtwDistance(a, other));
  });
});

describe("TemplateClassifier", () => {
  it("separates distinct words", () => {
    const templates: Template[] = [];
    for (let i = 0; i < 6; i++) {
      templates.push(template("yes", take(2, 0)));
      templates.push(template("no", take(3, 1)));
    }
    const classifier = TemplateClassifier.build(templates, ALL_FEATURES)!;
    expect(classifier).not.toBeNull();
    const prediction = classifier.predict(take(3, 1), { maxDistance: 10, minConfidence: 0 });
    expect(prediction.ranked[0].label).toBe("no");
    expect(prediction.accepted).toBe(true);
    expect(prediction.ranked.reduce((s, r) => s + r.score, 0)).toBeCloseTo(1, 9);
    expect(prediction.confidence).toBeGreaterThan(0.3);
  });

  it("needs at least two words", () => {
    expect(TemplateClassifier.build([template("yes", take(2, 0))], ALL_FEATURES)).toBeNull();
  });
});

describe("vote", () => {
  const neighbours = [
    { label: "no", distance: 0.5 },
    { label: "yes", distance: 0.55 },
    { label: "yes", distance: 0.6 },
    { label: "yes", distance: 0.62 },
    { label: "no", distance: 1.8 },
    { label: "maybe", distance: 2.5 },
  ];

  it("lets k nearest outweigh one close outlier", () => {
    expect(vote(neighbours, 1)[0].label).toBe("no");
    const k3 = vote(neighbours, 3);
    expect(k3[0].label).toBe("yes");
    expect(new Set(k3.map((r) => r.label))).toEqual(new Set(["yes", "no", "maybe"]));
    expect(k3.find((r) => r.label === "no")?.distance).toBe(0.5);
    expect(k3.reduce((s, r) => s + r.score, 0)).toBeCloseTo(1, 9);
  });

  it("handles infinite distances and single words", () => {
    const ranked = vote([{ label: "a", distance: Infinity }, { label: "b", distance: Infinity }], 3);
    expect(ranked).toHaveLength(2);
    expect(margin(ranked)).toBe(0);
    expect(margin([{ label: "a", distance: 0.1, score: 1 }])).toBe(0);
  });
});

describe("evaluate", () => {
  it("beats chance only when signal exists", () => {
    const real: Template[] = [];
    const noise: Template[] = [];
    for (let i = 0; i < 8; i++) {
      real.push(template("yes", take(2, 0)));
      real.push(template("no", take(3, 2)));
      noise.push(template("yes", take(0, 0, 30, 0.05)));
      noise.push(template("no", take(0, 0, 30, 0.05)));
    }
    const signal = evaluate(real, { featureSet: ALL_FEATURES, permutations: 200 }, random)!;
    expect(signal.accuracy).toBeGreaterThan(0.9);
    expect(signal.pValue).toBeLessThan(0.01);

    const nul = evaluate(noise, { featureSet: ALL_FEATURES, permutations: 200 }, random)!;
    expect(nul.pValue).toBeGreaterThan(0.01);
  });

  it("returns null without two takes per word", () => {
    expect(evaluate([template("yes", take(2, 0)), template("no", take(3, 1))], { featureSet: ALL_FEATURES })).toBeNull();
  });
});

describe("trim", () => {
  it("drops quiet padding", () => {
    const quiet = Array.from({ length: 20 }, (_, i) => makeSample(i / 25));
    const burst = take(2, 0, 30, 0).map((s) => ({ ...s, t: s.t + 0.8 }));
    const tail = quiet.map((s) => ({ ...s, t: s.t + 2 }));
    const trimmed = trim([...quiet, ...burst, ...tail]);
    expect(trimmed.length).toBeLessThan(40);
    expect(trimmed.length).toBeGreaterThanOrEqual(20);
  });
});

describe("CaptureController", () => {
  it("emits a segment for a held capture with pre-roll", () => {
    const capture = new CaptureController();
    const segments: MotionSample[][] = [];
    capture.onSegment = (s) => segments.push(s);
    for (let i = 0; i < 25; i++) capture.ingest(makeSample(i / 25));
    capture.begin();
    for (let i = 25; i < 50; i++) capture.ingest(makeSample(i / 25, [0.2, 0, 0]));
    capture.end();
    expect(segments).toHaveLength(1);
    // 0.3 s of pre-roll (≈7 frames) plus 25 held frames.
    expect(segments[0].length).toBeGreaterThan(25);
    expect(segments[0].length).toBeLessThan(35);
  });

  it("auto-detects a burst after calibration", () => {
    const capture = new CaptureController();
    const segments: MotionSample[][] = [];
    capture.onSegment = (s) => segments.push(s);
    capture.setAutoEnabled(true);
    capture.calibrate();
    let t = 0;
    for (let i = 0; i < 60; i++, t += 0.04) capture.ingest(makeSample(t, [0.01, 0, 0]));
    expect(capture.isCalibrating).toBe(false);
    expect(capture.noiseFloor).not.toBeNull();
    for (let i = 0; i < 15; i++, t += 0.04) capture.ingest(makeSample(t, [0.3, 0, 0]));
    for (let i = 0; i < 30; i++, t += 0.04) capture.ingest(makeSample(t, [0.01, 0, 0]));
    expect(segments).toHaveLength(1);
  });
});
