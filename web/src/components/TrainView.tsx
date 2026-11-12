import { useEffect, useRef, useState } from "react";
import { templateDuration, type Template } from "../engine/classifier";
import type { Evaluation } from "../engine/evaluation";
import { Feature } from "../engine/motion";
import { takeCounts } from "../engine/dataset";
import { useModel } from "../useModel";
import { HoldButton, Stepper } from "./Controls";
import { ROTATION, SignalPlot } from "./SignalPlot";

export function TrainView() {
  const model = useModel();
  const word = model.selectedWord;
  const streaming = model.bridge.motion === "streaming";

  return (
    <div className="split">
      <Vocabulary />
      <div className="stack">
        <div className="stack" style={{ gap: 10 }}>
          <p className="muted">
            Silently mouth <b>“{word ?? "—"}”</b> while holding Space. Keep your head still; aim for 8–10 takes per word.
          </p>
          <HoldButton
            title={`Mouth “${word ?? "—"}”`}
            isCapturing={model.capture.isCapturing}
            enabled={word !== null && streaming}
            onBegin={() => model.capture.begin()}
            onEnd={() => model.capture.end()}
          />
          {!streaming && <div className="notice small">Motion isn't streaming: {model.bridge.state === "connected" ? model.bridge.motion : "bridge not connected"}. See the Sensors tab.</div>}
          {word && <ExpansionField word={word} />}
        </div>
        {word && <Takes word={word} />}
        <EvaluationPanel />
      </div>
    </div>
  );
}

function Vocabulary() {
  const model = useModel();
  const [newWord, setNewWord] = useState("");
  const counts = takeCounts(model.dataset);
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef(false);

  const add = () => {
    model.addWord(newWord);
    setNewWord("");
  };
  const pick = (replace: boolean) => {
    replaceRef.current = replace;
    fileRef.current?.click();
  };

  return (
    <div className="card">
      <h3>Vocabulary</h3>
      <div className="vocab">
        {model.dataset.vocabulary.map((w) => (
          <div key={w} className={`word ${w === model.selectedWord ? "selected" : ""}`} onClick={() => model.selectWord(w)}>
            <span>{w}</span>
            <span className="count mono">
              {counts[w] ?? 0}
              <button className="icon" title={`Delete “${w}” and its takes`} onClick={(e) => { e.stopPropagation(); if (confirm(`Delete “${w}” and its ${counts[w] ?? 0} takes?`)) model.removeWord(w); }}>×</button>
            </span>
          </div>
        ))}
        {model.dataset.vocabulary.length === 0 && <p className="muted small">No words yet.</p>}
      </div>
      <div className="addword">
        <input type="text" placeholder="Add word" value={newWord} onChange={(e) => setNewWord(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
        <button className="btn" onClick={add} disabled={!newWord.trim()}>+</button>
      </div>
      <div className="wrap" style={{ marginTop: 12, gap: 6 }}>
        <button className="btn sm" onClick={() => model.exportDataset()} disabled={model.dataset.templates.length === 0}>Export</button>
        <button className="btn sm" onClick={() => pick(false)}>Import (merge)</button>
        <button className="btn sm" onClick={() => pick(true)}>Import (replace)</button>
      </div>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) void model.importDataset(file, replaceRef.current);
        e.target.value = "";
      }} />
      <p className="small muted" style={{ marginTop: 10 }}>Dataset files are interchangeable with the native macOS app.</p>
    </div>
  );
}

/** Optional output text for a word: mouth "brb", get "be right back". */
function ExpansionField({ word }: { word: string }) {
  const model = useModel();
  const [text, setText] = useState(model.dataset.expansions[word] ?? "");
  useEffect(() => { setText(model.dataset.expansions[word] ?? ""); }, [word]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="field">
      <span className="muted">Outputs as</span>
      <input
        type="text"
        style={{ flex: 1 }}
        placeholder={`“${word}” (set a phrase to expand it)`}
        value={text}
        onChange={(e) => { setText(e.target.value); model.setExpansion(word, e.target.value); }}
      />
    </label>
  );
}

function Takes({ word }: { word: string }) {
  const model = useModel();
  const takes = [...model.templatesFor(word)].reverse();
  return (
    <div className="card">
      <h2>Takes for “{word}” ({takes.length})</h2>
      {takes.length === 0
        ? <p className="muted">No takes yet.</p>
        : (
          <div className="takes">
            {takes.map((t) => <TakeTile key={t.id} template={t} isNew={t.id === model.lastTemplateId} onDelete={() => model.deleteTemplate(t.id)} />)}
          </div>
        )}
    </div>
  );
}

function TakeTile({ template, isNew, onDelete }: { template: Template; isNew: boolean; onDelete: () => void }) {
  return (
    <div className={`take ${isNew ? "new" : ""}`}>
      <SignalPlot samples={template.samples} channels={ROTATION} minScale={0.05} height={44} />
      <div className="foot">
        <span className="mono">{templateDuration(template).toFixed(2)} s · {template.samples.length}</span>
        <button className="icon" title="Delete take" onClick={onDelete}>🗑</button>
      </div>
    </div>
  );
}

function EvaluationPanel() {
  const model = useModel();
  const { featureSet, k } = model.settings;
  const toggle = (bit: number) => (on: boolean) => model.updateSettings({ featureSet: on ? featureSet | bit : featureSet & ~bit });
  return (
    <div className="card">
      <h2>Is there signal? (leave-one-out + permutation test)</h2>
      <div className="stack" style={{ gap: 12 }}>
        <div className="wrap">
          <span>Features:</span>
          <FeatureToggle label="Acceleration" on={Boolean(featureSet & Feature.acceleration)} onChange={toggle(Feature.acceleration)} />
          <FeatureToggle label="Rotation" on={Boolean(featureSet & Feature.rotation)} onChange={toggle(Feature.rotation)} />
          <FeatureToggle label="Attitude" on={Boolean(featureSet & Feature.attitude)} onChange={toggle(Feature.attitude)} />
          <Stepper label="k =" value={k} min={1} max={9} onChange={(v) => model.updateSettings({ k: v })} />
          <span className="spacer" />
          <button className="btn primary" onClick={() => model.evaluate()} disabled={model.isEvaluating || featureSet === 0}>
            {model.isEvaluating ? `Evaluating… ${Math.round(model.evaluationProgress * 100)}%` : "Evaluate"}
          </button>
        </div>
        {model.evaluation
          ? <EvaluationResult result={model.evaluation} />
          : (
            <p className="small muted">
              Needs ≥ 2 words with ≥ 2 takes each. Each take is classified against all the others; the same is repeated with shuffled labels to show what chance looks like.
            </p>
          )}
      </div>
    </div>
  );
}

function FeatureToggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function EvaluationResult({ result }: { result: Evaluation }) {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const significant = result.pValue < 0.05;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="metrics">
        <Metric label="Accuracy" value={pct(result.accuracy)} highlight />
        <Metric label="Chance" value={pct(result.chance)} />
        <Metric label="Shuffled 95th pct" value={pct(result.permutationP95)} />
        <Metric label="p-value" value={result.pValue < 0.001 ? "< 0.001" : result.pValue.toFixed(3)} />
      </div>
      <p className={significant ? "ok" : "warn"}>
        {significant
          ? `Motion carries word information beyond chance across ${result.templateCount} takes (k = ${result.k}).`
          : "Not distinguishable from chance yet — record more takes or try other feature sets."}
      </p>
      <table className="confusion">
        <thead>
          <tr>
            <th className="muted">actual ↓ / predicted →</th>
            {result.labels.map((l) => <th key={l}>{l}</th>)}
          </tr>
        </thead>
        <tbody>
          {result.labels.map((l, row) => {
            const total = Math.max(result.confusion[row].reduce((a, b) => a + b, 0), 1);
            return (
              <tr key={l}>
                <th style={{ textAlign: "right" }}>{l}</th>
                {result.labels.map((m, col) => {
                  const count = result.confusion[row][col];
                  const alpha = (count / total) * 0.7;
                  return (
                    <td key={m} className="mono" style={{ background: row === col ? `rgba(47,168,79,${alpha})` : `rgba(229,72,77,${alpha})` }}>
                      {count}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Metric({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`metric ${highlight ? "highlight" : ""}`}>
      <div className="label">{label}</div>
      <div className="value mono">{value}</div>
    </div>
  );
}
