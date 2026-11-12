import { BridgeClient } from "./bridge";
import { CaptureController, type CaptureMode } from "./engine/capture";
import { TemplateClassifier, type Prediction, type Template } from "./engine/classifier";
import { emptyDataset, loadDataset, merge, outputFor, parseDataset, saveDataset, serializeDataset, type Dataset } from "./engine/dataset";
import type { Evaluation } from "./engine/evaluation";
import { ALL_FEATURES, type FeatureSet, type MotionSample } from "./engine/motion";

export type Screen = "sensors" | "train" | "decode";

export interface DecodedWord {
  id: string;
  prediction: Prediction;
  /** The text this word produced (its expansion, or the word itself). */
  output: string;
}

export function decodedText(word: DecodedWord): string {
  return word.prediction.accepted ? word.output : word.prediction.ranked[0]?.label ?? "?";
}

const HISTORY_SECONDS = 10;
const SETTINGS_KEY = "silentspeak.settings.v1";

interface Settings {
  featureSet: FeatureSet;
  k: number;
  maxDistance: number;
  minConfidence: number;
  speaks: boolean;
  types: boolean;
  hotkeyEnabled: boolean;
  speechRate: number;
}

const DEFAULT_SETTINGS: Settings = {
  featureSet: ALL_FEATURES,
  k: 3,
  maxDistance: 1.5,
  minConfidence: 0.1,
  speaks: false,
  types: false,
  hotkeyEnabled: false,
  speechRate: 1,
};

/** All app state and behaviour. Views subscribe and re-render on change. */
export class AppModel {
  readonly bridge = new BridgeClient();
  readonly capture = new CaptureController();

  screen: Screen = "train";
  dataset: Dataset;
  selectedWord: string | null;
  settings: Settings;

  classifier: TemplateClassifier | null = null;
  evaluation: Evaluation | null = null;
  isEvaluating = false;
  evaluationProgress = 0;
  lastTemplateId: string | null = null;

  decodeMode: CaptureMode = "hold";
  decoded: DecodedWord[] = [];
  lastSegment: MotionSample[] = [];
  lastOutput = "";

  history: MotionSample[] = [];
  latest: MotionSample | null = null;
  sampleRate = 0;
  sampleCount = 0;

  statusMessage: string | null = null;

  version = 0;
  private listeners = new Set<() => void>();
  private frame: number | null = null;
  private rateWindow: number[] = [];
  private worker: Worker | null = null;
  private statusTimer: number | null = null;
  private saveTimer: number | null = null;
  private started = false;

  constructor() {
    this.dataset = loadDataset();
    this.selectedWord = this.dataset.vocabulary[0] ?? null;
    this.settings = { ...DEFAULT_SETTINGS, ...loadSettings() };
    this.rebuildClassifier();
  }

  // MARK: Subscription

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  notify(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Coalesces high-rate updates (motion samples) into one render per frame. */
  private markDirty(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.notify();
    });
  }

  // MARK: Lifecycle

  start(): void {
    if (this.started) return;
    this.started = true;
    this.bridge.onChange = () => this.notify();
    this.bridge.onSample = (s) => this.ingest(s);
    this.bridge.onKey = (key, down) => this.handleHotkey(key, down);
    this.bridge.onTyped = (ok, accessibility) => {
      if (!ok) this.setStatus(accessibility ? "Typing failed." : "Typing needs Accessibility access for the bridge's terminal.");
    };
    this.capture.onSegment = (segment) => this.handleSegment(segment);
    this.capture.onChange = () => this.markDirty();
    this.bridge.connect();
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", () => this.capture.end());
    window.addEventListener("pagehide", () => this.flushSave());
  }

  setScreen(screen: Screen): void {
    this.screen = screen;
    this.syncCaptureMode();
    this.notify();
  }

  private syncCaptureMode(): void {
    this.capture.setAutoEnabled(this.screen === "decode" && this.decodeMode === "auto");
  }

  private ingest(sample: MotionSample): void {
    this.latest = sample;
    this.sampleCount++;
    this.history.push(sample);
    const cutoff = sample.t - HISTORY_SECONDS;
    const firstKept = this.history.findIndex((s) => s.t >= cutoff);
    if (firstKept > 0) this.history.splice(0, firstKept);

    this.rateWindow.push(sample.t);
    this.rateWindow = this.rateWindow.filter((t) => t >= sample.t - 1);
    if (this.rateWindow.length > 1) {
      this.sampleRate = (this.rateWindow.length - 1) / (sample.t - this.rateWindow[0]);
    }

    this.capture.ingest(sample);
    this.markDirty();
  }

  private handleSegment(segment: MotionSample[]): void {
    this.lastSegment = segment;
    switch (this.screen) {
      case "train": {
        if (!this.selectedWord) return;
        this.addTemplate({ id: crypto.randomUUID(), label: this.selectedWord, samples: segment, createdAt: new Date().toISOString() });
        break;
      }
      case "decode": {
        if (!this.classifier) return;
        const { k, maxDistance, minConfidence } = this.settings;
        const prediction = this.classifier.predict(segment, { k, maxDistance, minConfidence });
        const best = prediction.ranked[0];
        const output = best ? outputFor(this.dataset, best.label) : "";
        this.decoded.push({ id: crypto.randomUUID(), prediction, output });
        if (prediction.accepted) this.emit(output);
        break;
      }
      case "sensors":
        break;
    }
    this.notify();
  }

  // MARK: Keys

  private get keyCapturesMotion(): boolean {
    const target = document.activeElement;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target as HTMLElement | null)?.isContentEditable) {
      return false;
    }
    switch (this.screen) {
      case "train": return this.selectedWord !== null;
      case "decode": return this.decodeMode === "hold" && this.classifier !== null;
      case "sensors": return false;
    }
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== "Space" || !this.keyCapturesMotion) return;
    event.preventDefault();
    if (!event.repeat) this.capture.begin();
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== "Space") return;
    if (this.keyCapturesMotion) event.preventDefault();
    this.capture.end();
  };

  private handleHotkey(key: string, down: boolean): void {
    if (!this.settings.hotkeyEnabled || key !== "rightOption") return;
    if (this.screen !== "decode" || this.decodeMode !== "hold" || !this.classifier) return;
    if (down) this.capture.begin();
    else this.capture.end();
  }

  // MARK: Output

  private emit(text: string): void {
    this.lastOutput = text;
    if (this.settings.speaks) this.speak(text);
    if (this.settings.types && !document.hasFocus()) this.bridge.type(text + " ");
  }

  speak(text: string): void {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = this.settings.speechRate;
    speechSynthesis.speak(utterance);
  }

  // MARK: Settings

  updateSettings(patch: Partial<Settings>): void {
    const previous = this.settings;
    this.settings = { ...previous, ...patch };
    saveSettings(this.settings);
    if (patch.featureSet !== undefined && patch.featureSet !== previous.featureSet) this.rebuildClassifier();
    if (patch.k !== undefined && patch.k !== previous.k) this.evaluation = null;
    this.notify();
  }

  setDecodeMode(mode: CaptureMode): void {
    this.decodeMode = mode;
    this.syncCaptureMode();
    this.notify();
  }

  // MARK: Dataset editing

  templatesFor(word: string): Template[] {
    return this.dataset.templates.filter((t) => t.label === word);
  }

  addWord(raw: string): void {
    const word = raw.trim().toLowerCase();
    if (!word || this.dataset.vocabulary.includes(word)) return;
    this.dataset = { ...this.dataset, vocabulary: [...this.dataset.vocabulary, word] };
    this.selectedWord = word;
    this.persist();
  }

  removeWord(word: string): void {
    const expansions = { ...this.dataset.expansions };
    delete expansions[word];
    this.dataset = {
      vocabulary: this.dataset.vocabulary.filter((w) => w !== word),
      templates: this.dataset.templates.filter((t) => t.label !== word),
      expansions,
    };
    if (this.selectedWord === word) this.selectedWord = this.dataset.vocabulary[0] ?? null;
    this.persist();
  }

  selectWord(word: string): void {
    this.selectedWord = word;
    this.notify();
  }

  setExpansion(word: string, text: string): void {
    const expansions = { ...this.dataset.expansions };
    if (text.trim()) expansions[word] = text;
    else delete expansions[word];
    this.dataset = { ...this.dataset, expansions };
    this.scheduleSave();
    this.notify();
  }

  addTemplate(template: Template): void {
    this.dataset = { ...this.dataset, templates: [...this.dataset.templates, template] };
    this.lastTemplateId = template.id;
    this.persist();
  }

  deleteTemplate(id: string): void {
    this.dataset = { ...this.dataset, templates: this.dataset.templates.filter((t) => t.id !== id) };
    this.persist();
  }

  private persist(): void {
    this.scheduleSave();
    this.rebuildClassifier();
    this.notify();
  }

  /** Serialising a few MB on every take adds up, so writes trail the last change by a moment. */
  private scheduleSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flushSave(), 300);
  }

  flushSave(): void {
    if (this.saveTimer === null) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!saveDataset(this.dataset)) this.setStatus("Couldn't save to browser storage. Export your dataset to keep it.");
  }

  private rebuildClassifier(): void {
    this.classifier = TemplateClassifier.build(this.dataset.templates, this.settings.featureSet);
    this.evaluation = null;
  }

  // MARK: Evaluation (off the main thread)

  evaluate(permutations = 500): void {
    if (this.isEvaluating) return;
    this.isEvaluating = true;
    this.evaluationProgress = 0;
    this.notify();
    this.worker?.terminate();
    const worker = new Worker(new URL("./evaluation.worker.ts", import.meta.url), { type: "module" });
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<{ type: string; fraction?: number; result?: Evaluation | null }>) => {
      if (event.data.type === "progress") {
        this.evaluationProgress = event.data.fraction ?? 0;
        this.markDirty();
      } else if (event.data.type === "result") {
        this.evaluation = event.data.result ?? null;
        this.isEvaluating = false;
        worker.terminate();
        this.worker = null;
        this.notify();
      }
    };
    worker.onerror = () => {
      this.isEvaluating = false;
      this.setStatus("Evaluation failed.");
    };
    worker.postMessage({ templates: this.dataset.templates, featureSet: this.settings.featureSet, k: this.settings.k, permutations });
  }

  // MARK: Import / export

  exportDataset(): void {
    const blob = new Blob([serializeDataset(this.dataset)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "silentspeak-dataset.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.setStatus(`Exported ${this.dataset.templates.length} takes.`);
  }

  async importDataset(file: File, replace: boolean): Promise<void> {
    try {
      const incoming = parseDataset(JSON.parse(await file.text()));
      this.dataset = replace ? incoming : merge(this.dataset, incoming);
      if (!this.selectedWord || !this.dataset.vocabulary.includes(this.selectedWord)) {
        this.selectedWord = this.dataset.vocabulary[0] ?? null;
      }
      this.persist();
      this.setStatus(`${replace ? "Replaced with" : "Merged"} ${incoming.templates.length} takes across ${incoming.vocabulary.length} words.`);
    } catch (error) {
      this.setStatus(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  resetDataset(): void {
    this.dataset = emptyDataset();
    this.selectedWord = this.dataset.vocabulary[0] ?? null;
    this.persist();
  }

  // MARK: Transcript

  get transcript(): string {
    return this.decoded.filter((w) => w.prediction.accepted).map(decodedText).join(" ");
  }

  clearDecoded(): void {
    this.decoded = [];
    this.lastSegment = [];
    this.notify();
  }

  setStatus(message: string | null): void {
    this.statusMessage = message;
    if (this.statusTimer !== null) clearTimeout(this.statusTimer);
    if (message) {
      this.statusTimer = window.setTimeout(() => {
        this.statusMessage = null;
        this.statusTimer = null;
        this.notify();
      }, 5000);
    }
    this.notify();
  }
}

function loadSettings(): Partial<Settings> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as Partial<Settings>) : {};
  } catch {
    return {};
  }
}

function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}

export const model = new AppModel();
