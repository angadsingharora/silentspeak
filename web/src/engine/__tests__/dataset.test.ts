import { describe, expect, it } from "vitest";
import { emptyDataset, loadDataset, merge, outputFor, parseDataset, saveDataset, serializeDataset, type Dataset } from "../dataset";
import { makeSample } from "../motion";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(k: string) { return this.map.get(k) ?? null; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  removeItem(k: string) { this.map.delete(k); }
  setItem(k: string, v: string) { this.map.set(k, v); }
}

describe("dataset", () => {
  it("parses the native app's format, including its date encoding", () => {
    const native = {
      vocabulary: ["yes", "no"],
      templates: [{
        id: "ABC", label: "yes", createdAt: 0,
        samples: [{ t: 0, ax: 0, ay: 0, az: 0, rx: 0.1, ry: 0, rz: 0, pitch: 0, roll: 0, yaw: 0, gx: 0, gy: 0, gz: -1, qw: 1, qx: 0, qy: 0, qz: 0 }],
      }],
    };
    const dataset = parseDataset(native);
    expect(dataset.expansions).toEqual({});
    expect(dataset.templates[0].createdAt).toBe("2001-01-01T00:00:00.000Z");
    expect(dataset.templates[0].samples[0].rx).toBe(0.1);
  });

  it("rejects malformed input", () => {
    expect(() => parseDataset({ vocabulary: "no" })).toThrow();
    expect(() => parseDataset({ vocabulary: [], templates: [{ label: "x", samples: [{ t: 0 }] }] })).toThrow();
  });

  it("round-trips through the native serialisation", () => {
    const dataset: Dataset = {
      vocabulary: ["yes"],
      templates: [{ id: "1", label: "yes", samples: [makeSample(0, [0.1, 0, 0]), makeSample(0.04)], createdAt: "2026-11-12T10:00:00.000Z" }],
      expansions: { yes: "yes please" },
    };
    const back = parseDataset(JSON.parse(serializeDataset(dataset)));
    expect(back).toEqual(dataset);
  });

  it("uses expansions for output and falls back to the word", () => {
    const d = emptyDataset();
    d.expansions.brb = "be right back";
    d.expansions.yes = "   ";
    expect(outputFor(d, "brb")).toBe("be right back");
    expect(outputFor(d, "yes")).toBe("yes");
  });

  it("merges without duplicating takes", () => {
    const shared = { id: "s", label: "yes", samples: [makeSample(0), makeSample(0.04)], createdAt: "x" };
    const a: Dataset = { vocabulary: ["yes"], templates: [shared], expansions: { yes: "yeah" } };
    const b: Dataset = { vocabulary: ["yes", "stop"], templates: [shared, { ...shared, id: "t", label: "stop" }], expansions: { yes: "yep" } };
    const m = merge(a, b);
    expect(m.vocabulary).toEqual(["yes", "stop"]);
    expect(m.templates).toHaveLength(2);
    expect(m.expansions.yes).toBe("yep");
  });

  it("persists to storage and survives corruption", () => {
    const storage = new MemoryStorage();
    const d = emptyDataset();
    d.vocabulary.push("hello");
    expect(saveDataset(d, storage)).toBe(true);
    expect(loadDataset(storage).vocabulary).toContain("hello");
    storage.setItem("silentspeak.dataset.v1", "{not json");
    expect(loadDataset(storage)).toEqual(emptyDataset());
  });
});
