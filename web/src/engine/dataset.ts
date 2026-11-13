import type { Template } from "./classifier";
import { LIP_DIMS, type MotionSample } from "./motion";

/**
 * The user's vocabulary, every recorded take, and what each word should produce.
 * Same JSON shape as the native app's dataset.json, so files move between the two.
 */
export interface Dataset {
  vocabulary: string[];
  templates: Template[];
  /** Optional output text per word. Mouth "brb", get "be right back". */
  expansions: Record<string, string>;
}

export const STARTER: Dataset = {
  vocabulary: ["yes", "no", "next", "back", "stop"],
  templates: [],
  expansions: {},
};

export function emptyDataset(): Dataset {
  return { vocabulary: [...STARTER.vocabulary], templates: [], expansions: {} };
}

/** What a decoded word turns into: its expansion if one is set, otherwise the word itself. */
export function outputFor(dataset: Dataset, word: string): string {
  const expansion = (dataset.expansions[word] ?? "").trim();
  return expansion.length ? expansion : word;
}

export function takeCounts(dataset: Dataset): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of dataset.templates) counts[t.label] = (counts[t.label] ?? 0) + 1;
  return counts;
}

/** Adds another dataset's words and takes. Takes already present (by id) are skipped. */
export function merge(into: Dataset, other: Dataset): Dataset {
  const vocabulary = [...into.vocabulary];
  for (const w of other.vocabulary) if (!vocabulary.includes(w)) vocabulary.push(w);
  const known = new Set(into.templates.map((t) => t.id));
  const templates = [...into.templates, ...other.templates.filter((t) => !known.has(t.id))];
  return { vocabulary, templates, expansions: { ...into.expansions, ...other.expansions } };
}

const SAMPLE_KEYS: (keyof MotionSample)[] = ["t", "ax", "ay", "az", "rx", "ry", "rz", "pitch", "roll", "yaw"];

/** Validates and normalises a parsed JSON value into a Dataset. Throws on malformed input. */
export function parseDataset(value: unknown): Dataset {
  if (typeof value !== "object" || value === null) throw new Error("Dataset must be a JSON object.");
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.vocabulary) || !v.vocabulary.every((w) => typeof w === "string")) {
    throw new Error("Dataset needs a vocabulary array of strings.");
  }
  if (!Array.isArray(v.templates)) throw new Error("Dataset needs a templates array.");
  const templates: Template[] = v.templates.map((raw, i) => {
    const t = raw as Record<string, unknown>;
    if (typeof t.label !== "string" || !Array.isArray(t.samples)) throw new Error(`Take ${i} is malformed.`);
    const samples: MotionSample[] = t.samples.map((s) => {
      const r = s as Record<string, unknown>;
      for (const key of SAMPLE_KEYS) {
        if (typeof r[key] !== "number") throw new Error(`Take ${i} has a sample without "${key}".`);
      }
      const sample: MotionSample = {
        t: r.t as number,
        ax: r.ax as number, ay: r.ay as number, az: r.az as number,
        rx: r.rx as number, ry: r.ry as number, rz: r.rz as number,
        pitch: r.pitch as number, roll: r.roll as number, yaw: r.yaw as number,
        gx: typeof r.gx === "number" ? r.gx : 0,
        gy: typeof r.gy === "number" ? r.gy : 0,
        gz: typeof r.gz === "number" ? r.gz : -1,
      };
      if (Array.isArray(r.lips) && r.lips.length === LIP_DIMS && r.lips.every((x) => typeof x === "number" && Number.isFinite(x))) {
        sample.lips = r.lips as number[];
      }
      return sample;
    });
    return {
      id: typeof t.id === "string" ? t.id : crypto.randomUUID(),
      label: t.label,
      samples,
      createdAt: normaliseDate(t.createdAt),
    };
  });
  const expansions: Record<string, string> = {};
  if (typeof v.expansions === "object" && v.expansions !== null) {
    for (const [k, val] of Object.entries(v.expansions as Record<string, unknown>)) {
      if (typeof val === "string") expansions[k] = val;
    }
  }
  return { vocabulary: v.vocabulary as string[], templates, expansions };
}

/** Swift's JSONEncoder writes dates as seconds since 2001-01-01; the web app writes ISO strings. */
function normaliseDate(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return new Date(Date.UTC(2001, 0, 1) + value * 1000).toISOString();
  return new Date().toISOString();
}

/** Serialises in the shape the native app reads, keeping the quaternion fields it expects. */
export function serializeDataset(dataset: Dataset): string {
  const templates = dataset.templates.map((t) => ({
    id: t.id,
    label: t.label,
    createdAt: (new Date(t.createdAt).getTime() - Date.UTC(2001, 0, 1)) / 1000,
    samples: t.samples.map((s) => ({ ...s, lips: s.lips?.map((v) => Math.round(v * 1000) / 1000), qw: 1, qx: 0, qy: 0, qz: 0 })),
  }));
  return JSON.stringify({ vocabulary: dataset.vocabulary, templates, expansions: dataset.expansions });
}

const STORAGE_KEY = "silentspeak.dataset.v1";

export function loadDataset(storage: Storage | undefined = globalThis.localStorage): Dataset {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return emptyDataset();
    return parseDataset(JSON.parse(raw));
  } catch {
    return emptyDataset();
  }
}

export function saveDataset(dataset: Dataset, storage: Storage | undefined = globalThis.localStorage): boolean {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(dataset));
    return true;
  } catch {
    return false;
  }
}
