import { describe, expect, it } from "vitest";
import { augmentations, augmentFrames, DEFAULT_AUGMENT, seededRandom } from "../augment";
import { TemplateClassifier, type Template } from "../classifier";
import { evaluate } from "../evaluation";
import { ALL_FEATURES, Feature, frames, makeSample, type MotionSample } from "../motion";

const random = seededRandom(7);

function take(frequency: number, axis: number, framesCount = 30, noise = 0.01): MotionSample[] {
  return Array.from({ length: framesCount }, (_, i) => {
    const envelope = Math.sin((Math.PI * i) / (framesCount - 1));
    const v = 0.2 * envelope * Math.sin((2 * Math.PI * frequency * i) / framesCount);
    const jitter = () => (random() * 2 - 1) * noise;
    const rotation: [number, number, number] = [jitter(), jitter(), jitter()];
    rotation[axis] += v;
    return makeSample(i / 25, rotation, [jitter(), jitter(), jitter()]);
  });
}

function template(label: string, samples: MotionSample[]): Template {
  return { id: crypto.randomUUID(), label, samples, createdAt: new Date().toISOString() };
}

describe("augmentFrames", () => {
  const base = frames(take(2, 0), ALL_FEATURES);

  it("is reproducible from the take id", () => {
    expect(augmentations(base, "abc")).toEqual(augmentations(base, "abc"));
    expect(augmentations(base, "abc")).not.toEqual(augmentations(base, "abd"));
    expect(augmentations(base, "abc")).toHaveLength(DEFAULT_AUGMENT.copies);
  });

  it("stays close to the original: bounded length, mean-centred, finite", () => {
    for (let i = 0; i < 50; i++) {
      const copy = augmentFrames(base, random);
      expect(copy.length).toBeGreaterThanOrEqual(Math.floor(base.length * 0.85));
      expect(copy.length).toBeLessThanOrEqual(Math.ceil(base.length * 1.15));
      expect(copy[0]).toHaveLength(base[0].length);
      for (let d = 0; d < copy[0].length; d++) {
        const mean = copy.reduce((s, f) => s + f[d], 0) / copy.length;
        expect(Math.abs(mean)).toBeLessThan(1e-9);
      }
      expect(copy.flat().every(Number.isFinite)).toBe(true);
    }
  });

  it("preserves energy roughly (a tilt, not a distortion)", () => {
    const norm = (fr: number[][]) => Math.sqrt(fr.flat().reduce((s, v) => s + v * v, 0) / fr.length);
    for (let i = 0; i < 50; i++) {
      const ratio = norm(augmentFrames(base, random)) / norm(base);
      expect(ratio).toBeGreaterThan(0.75);
      expect(ratio).toBeLessThan(1.25);
    }
  });

  it("survives empty, single-frame and constant input", () => {
    expect(augmentFrames([], random)).toEqual([]);
    const one = augmentFrames([[1, 2, 3]], random);
    expect(one.flat().every(Number.isFinite)).toBe(true);
    const flat = augmentFrames(Array.from({ length: 10 }, () => [0, 0, 0]), random);
    expect(flat.flat().every((v) => v === 0)).toBe(true);
  });
});

describe("augmented classifier", () => {
  it("adds copies but counts only real takes", () => {
    const templates = [0, 1, 2].flatMap(() => [template("yes", take(2, 0)), template("no", take(3, 1))]);
    const plain = TemplateClassifier.build(templates, ALL_FEATURES)!;
    const aug = TemplateClassifier.build(templates, ALL_FEATURES, DEFAULT_AUGMENT)!;
    expect(plain.entryCount).toBe(6);
    expect(aug.templateCount).toBe(6);
    expect(aug.entryCount).toBe(6 * (1 + DEFAULT_AUGMENT.copies));
    expect(aug.predict(take(3, 1), { maxDistance: 10, minConfidence: 0 }).ranked[0].label).toBe("no");
  });
});

describe("augmented evaluation", () => {
  it("never lets a held-out take see its own copies", () => {
    // Pure noise: if a take's copies leaked into its own fold they'd be its nearest
    // neighbours and accuracy would shoot up.
    const noise: Template[] = [];
    for (let i = 0; i < 10; i++) {
      noise.push(template("yes", take(0, 0, 30, 0.05)));
      noise.push(template("no", take(0, 0, 30, 0.05)));
    }
    const result = evaluate(noise, { featureSet: ALL_FEATURES, permutations: 200, augment: DEFAULT_AUGMENT }, random)!;
    expect(result.augmented).toBe(true);
    expect(result.accuracy).toBeLessThan(0.8);
    expect(result.pValue).toBeGreaterThan(0.01);
  });

  it("still finds real signal and reports the real-only baseline", () => {
    const real: Template[] = [];
    for (let i = 0; i < 3; i++) {
      real.push(template("yes", take(2, 0)));
      real.push(template("no", take(3, 2)));
    }
    const result = evaluate(real, { featureSet: Feature.rotation, permutations: 200, augment: DEFAULT_AUGMENT }, random)!;
    expect(result.accuracy).toBeGreaterThan(0.9);
    expect(result.baselineAccuracy).not.toBeNull();
    expect(evaluate(real, { featureSet: Feature.rotation, permutations: 10 }, random)!.baselineAccuracy).toBeNull();
  });

  it("evaluates 60 takes with copies and 500 permutations in reasonable time", () => {
    const templates: Template[] = [];
    for (let w = 0; w < 6; w++) for (let i = 0; i < 10; i++) templates.push(template(`w${w}`, take(1 + w * 0.5, w % 3)));
    const start = performance.now();
    const result = evaluate(templates, { featureSet: ALL_FEATURES, permutations: 500, augment: DEFAULT_AUGMENT }, random)!;
    const elapsed = performance.now() - start;
    expect(result.templateCount).toBe(60);
    expect(elapsed).toBeLessThan(15000);
    console.log(`augmented evaluation of 60 takes: ${Math.round(elapsed)} ms`);
  });
});
