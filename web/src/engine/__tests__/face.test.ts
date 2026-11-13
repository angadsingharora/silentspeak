import { describe, expect, it } from "vitest";
import { augmentFrames, seededRandom } from "../augment";
import { TemplateClassifier, type Template } from "../classifier";
import { parseDataset, serializeDataset } from "../dataset";
import { GATE, LIP_CHANNELS, lipSpeed, lipVector, MouthGate } from "../face";
import { ALL_FEATURES, Feature, frames, LIP_DIMS, makeSample, motionDims } from "../motion";

describe("lip vector", () => {
  it("maps blendshapes in channel order and averages left/right pairs", () => {
    const v = lipVector([
      { categoryName: "jawOpen", score: 0.5 },
      { categoryName: "mouthSmileLeft", score: 0.2 },
      { categoryName: "mouthSmileRight", score: 0.6 },
      { categoryName: "browInnerUp", score: 0.9 },
    ]);
    expect(v).toHaveLength(LIP_DIMS);
    expect(v[0]).toBe(0.5);
    expect(v[LIP_CHANNELS.findIndex((c) => c[0] === "mouthSmileLeft")]).toBeCloseTo(0.4);
    expect(v.filter((x) => x !== 0)).toHaveLength(2);
  });

  it("speed is distance per second", () => {
    expect(lipSpeed([0, 0], [0.3, 0.4], 0.5)).toBeCloseTo(1);
    expect(lipSpeed([0], [1], 0)).toBe(0);
  });
});

describe("mouth gate", () => {
  function run(speeds: number[], fps = 30): { events: string[]; gate: MouthGate } {
    const gate = new MouthGate();
    const events: string[] = [];
    gate.onStart = () => events.push("start");
    gate.onStop = () => events.push("stop");
    let v = 0;
    speeds.forEach((s, i) => {
      v += s / fps; // move the first channel at the requested speed
      gate.ingest([v, 0, 0], i / fps);
    });
    return { events, gate };
  }

  it("opens on sustained movement and closes after a pause", () => {
    const still = Array(30).fill(0);
    const moving = Array(15).fill(GATE.threshold * 4);
    const { events, gate } = run([...still, ...moving, ...still]);
    expect(events).toEqual(["start", "stop"]);
    expect(gate.isOpen).toBe(false);
  });

  it("ignores a single-frame blip", () => {
    const { events } = run([...Array(30).fill(0), GATE.threshold * 4, ...Array(30).fill(0)]);
    expect(events).toEqual([]);
  });

  it("closes a segment that runs too long, then reopens if the mouth keeps going", () => {
    const { events } = run(Array(30 * (GATE.maxSeconds + 1)).fill(GATE.threshold * 4));
    expect(events.slice(0, 3)).toEqual(["start", "stop", "start"]);
  });

  it("reset while open emits stop", () => {
    const { events, gate } = run([...Array(30).fill(0), ...Array(15).fill(GATE.threshold * 4)]);
    expect(events).toEqual(["start"]);
    gate.reset();
    expect(events).toEqual(["start", "stop"]);
  });
});

describe("lips in the engine", () => {
  const lipsA = Array.from({ length: LIP_DIMS }, (_, i) => (i % 2 ? 0.1 : 0.6));
  const lipsB = Array.from({ length: LIP_DIMS }, (_, i) => (i % 2 ? 0.6 : 0.1));
  const take = (lips: number[], n = 20) => Array.from({ length: n }, (_, i) => makeSample(i / 30, [0, 0, 0], [0, 0, 0], [0, 0, 0], lips.map((v) => v * Math.sin((Math.PI * i) / (n - 1)))));
  const tpl = (label: string, samples: ReturnType<typeof take>): Template => ({ id: crypto.randomUUID(), label, samples, createdAt: "" });

  it("frames append lip channels only when the feature is on, zeros when absent", () => {
    const withLips = frames(take(lipsA, 3), ALL_FEATURES | Feature.lips);
    expect(withLips[0]).toHaveLength(9 + LIP_DIMS);
    expect(frames(take(lipsA, 3), ALL_FEATURES)[0]).toHaveLength(9);
    const noLips = frames([makeSample(0), makeSample(0.04), makeSample(0.08)], Feature.lips);
    expect(noLips[0]).toEqual(Array(LIP_DIMS).fill(0));
    expect(motionDims(ALL_FEATURES | Feature.lips)).toBe(9);
    expect(motionDims(Feature.lips)).toBe(0);
  });

  it("separates two words by lip shape alone, with no AirPods motion at all", () => {
    const templates: Template[] = [];
    for (let i = 0; i < 4; i++) {
      templates.push(tpl("ooh", take(lipsA)));
      templates.push(tpl("eee", take(lipsB)));
    }
    const c = TemplateClassifier.build(templates, ALL_FEATURES | Feature.lips)!;
    const p = c.predict(take(lipsB), { maxDistance: 5, minConfidence: 0 });
    expect(p.ranked[0].label).toBe("eee");
    expect(p.confidence).toBeGreaterThan(0.3);
  });

  it("augmentation tilts motion axes but leaves lip channels untilted", () => {
    const fr = frames(take(lipsA, 12), ALL_FEATURES | Feature.lips);
    const random = seededRandom(3);
    const copy = augmentFrames(fr, random, { copies: 1, stretch: 0, gain: 0, tilt: 0.5, noise: 0 }, motionDims(ALL_FEATURES | Feature.lips));
    expect(copy).toHaveLength(fr.length);
    for (let i = 0; i < fr.length; i++) {
      for (let d = 9; d < 9 + LIP_DIMS; d++) expect(copy[i][d]).toBeCloseTo(fr[i][d], 9);
    }
  });

  it("lips round-trip through dataset JSON", () => {
    const dataset = { vocabulary: ["ooh"], templates: [tpl("ooh", take(lipsA, 3))], expansions: {} };
    const back = parseDataset(JSON.parse(serializeDataset(dataset)));
    expect(back.templates[0].samples[0].lips).toHaveLength(LIP_DIMS);
    expect(back.templates[0].samples[1].lips![0]).toBeCloseTo(dataset.templates[0].samples[1].lips![0], 3);
    const bad = parseDataset({ vocabulary: ["x"], templates: [{ label: "x", samples: [{ ...makeSample(0), lips: [1, 2] }] }] });
    expect(bad.templates[0].samples[0].lips).toBeUndefined();
  });
});
