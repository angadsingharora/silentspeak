import { useEffect, useRef, useState } from "react";
import { DEFAULT_AUGMENT } from "../engine/augment";
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
  const streaming = model.bridge.motion === "streaming" || model.cameraTracking;
  const gated = model.settings.lipGate && model.cameraTracking;

  return (
    <div className="split">
      <Vocabulary />
      <div className="stack">
        <div className="stack" style={{ gap: 10 }}>
          <p className="muted">
            {gated
              ? <>Silently mouth “{word ?? "—"}”; the camera starts and stops the take when your mouth moves. Or hold Space.</>
              : <>Hold Space and silently mouth “{word ?? "—"}”. Keep your head still.</>}
            {" "}With “extra takes” on, 3–5 per word may be enough; Evaluate will tell you.
          </p>
          <HoldButton
            title={`Mouth “${word ?? "—"}”`}
            isCapturing={model.capture.isCapturing}
            enabled={word !== null && streaming}
            onBegin={() => model.capture.begin()}
            onEnd={() => model.capture.end()}
          />
          {!streaming && <div className="notice">No signal yet ({model.bridge.state === "connected" ? model.bridge.motion : "bridge not running"}, camera {model.camera.status}). See Sensors.</div>}
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
        <button className="btn sm" onClick={add} disabled={!newWord.trim()}>add</button>
      </div>
      <div className="wrap small" style={{ marginTop: 12, gap: 10 }}>
        <button className="icon" style={{ padding: 0 }} onClick={() => model.exportDataset()} disabled={model.dataset.templates.length === 0}>export</button>
        <button className="icon" style={{ padding: 0 }} onClick={() => pick(false)}>import</button>
        <button className="icon" style={{ padding: 0 }} onClick={() => pick(true)}>replace</button>
      </div>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) void model.importDataset(file, replaceRef.current);
        e.target.value = "";
      }} />
      <p className="small muted" style={{ marginTop: 8 }}>Same JSON as the native app.</p>
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
      <span className="muted">outputs as</span>
      <input
        type="text"
        style={{ flex: 1 }}
        placeholder={`${word} (or a longer phrase)`}
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
      <h2>{word}: {takes.length} takes</h2>
      {takes.length === 0
        ? <p className="muted">none yet</p>
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
        <button className="icon" title="delete" onClick={onDelete}>×</button>
      </div>
    </div>
  );
}

function EvaluationPanel() {
  const model = useModel();
  const { featureSet, k, augment } = model.settings;
  const toggle = (bit: number) => (on: boolean) => model.updateSettings({ featureSet: on ? featureSet | bit : featureSet & ~bit });
  return (
    <div className="card">
      <h2>Evaluation</h2>
      <div className="stack" style={{ gap: 12 }}>
        <div className="wrap">
          <span className="muted">features</span>
          <FeatureToggle label="acceleration" on={Boolean(featureSet & Feature.acceleration)} onChange={toggle(Feature.acceleration)} />
          <FeatureToggle label="rotation" on={Boolean(featureSet & Feature.rotation)} onChange={toggle(Feature.rotation)} />
          <FeatureToggle label="attitude" on={Boolean(featureSet & Feature.attitude)} onChange={toggle(Feature.attitude)} />
          <FeatureToggle label="lips" on={Boolean(featureSet & Feature.lips)} onChange={toggle(Feature.lips)} />
          <label className="check" title="Add a few slightly varied copies of every take: tilted, louder or softer, faster or slower, with a little noise">
            <input type="checkbox" checked={augment} onChange={(e) => model.updateSettings({ augment: e.target.checked })} />
            extra takes
          </label>
          <Stepper label="k =" value={k} min={1} max={9} onChange={(v) => model.updateSettings({ k: v })} />
          <span className="spacer" />
          <button className="btn primary" onClick={() => model.evaluate()} disabled={model.isEvaluating || featureSet === 0}>
            {model.isEvaluating ? `${Math.round(model.evaluationProgress * 100)}%` : "evaluate"}
          </button>
        </div>
        {model.evaluation
          ? <EvaluationResult result={model.evaluation} />
          : (
            <p className="small muted">
              Leave-one-out accuracy, then the same with labels shuffled 500 times. Needs two words with two takes each.
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
        <Metric label="accuracy" value={pct(result.accuracy)} />
        <Metric label="chance" value={pct(result.chance)} />
        <Metric label="shuffled, 95th pct" value={pct(result.permutationP95)} />
        <Metric label="p" value={result.pValue < 0.001 ? "< 0.001" : result.pValue.toFixed(3)} />
      </div>
      <p className={significant ? "ok" : "warn"}>
        {significant
          ? `Better than chance over ${result.templateCount} takes, k = ${result.k}.`
          : result.accuracy > result.chance && result.accuracy >= result.permutationP95
            ? "Right on these takes, but there are too few to rule out luck. Add a take or two per word."
            : "Not better than chance yet. More takes, or try other features."}
      </p>
      {result.baselineAccuracy !== null && (
        <p className="small muted">
          With {DEFAULT_AUGMENT.copies} extra takes per take. Real takes only: {pct(result.baselineAccuracy)}.
        </p>
      )}
      <table className="confusion">
        <thead>
          <tr>
            <th>actual \ predicted</th>
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <div className="label">{label}</div>
      <div className="value mono">{value}</div>
    </div>
  );
}
