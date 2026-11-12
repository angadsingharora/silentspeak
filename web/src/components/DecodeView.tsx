import { decodedText } from "../model";
import { useModel } from "../useModel";
import { HoldButton, LevelMeter, Segmented, SliderField, Stepper } from "./Controls";
import { ROTATION, SignalPlot } from "./SignalPlot";

/** The "motion → text" screen: segments are classified and appended to a running transcript. */
export function DecodeView() {
  const model = useModel();
  return (
    <div className="stack">
      {model.classifier === null && <div className="notice">Record takes for at least two words first.</div>}
      <Controls />
      <Transcript />
      <OutputPanel />
      <LastSegment />
    </div>
  );
}

function Controls() {
  const model = useModel();
  const { capture, settings } = model;
  const ready = model.classifier !== null && model.bridge.motion === "streaming";
  return (
    <div className="card">
      <div className="stack" style={{ gap: 12 }}>
        <Segmented
          value={model.decodeMode}
          options={[{ value: "hold", label: "hold Space" }, { value: "auto", label: "auto" }]}
          onChange={(m) => model.setDecodeMode(m)}
        />
        {model.decodeMode === "hold"
          ? <HoldButton title="mouth a word" isCapturing={capture.isCapturing} enabled={ready} onBegin={() => capture.begin()} onEnd={() => capture.end()} />
          : <AutoControls />}
        <div className="wrap">
          <SliderField label="max distance" value={settings.maxDistance} min={0.2} max={4} step={0.05} onChange={(v) => model.updateSettings({ maxDistance: v })} />
          <SliderField label="min confidence" value={settings.minConfidence} min={0} max={0.5} step={0.01} onChange={(v) => model.updateSettings({ minConfidence: v })} />
          <Stepper label="k" value={settings.k} min={1} max={9} onChange={(v) => model.updateSettings({ k: v })} />
        </div>
        {settings.hotkeyEnabled && <p className="small muted">Right Option works from any app while this tab is open.</p>}
      </div>
    </div>
  );
}

function AutoControls() {
  const model = useModel();
  const { capture } = model;
  const scaleMax = Math.max((capture.threshold ?? 0.05) * 2, 0.02);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="wrap">
        <button className="btn" onClick={() => capture.calibrate()} disabled={capture.isCalibrating || model.bridge.motion !== "streaming"}>
          {capture.isCalibrating ? "stay still…" : "calibrate"}
        </button>
        {capture.noiseFloor !== null && <span className="small muted mono">floor {capture.noiseFloor.toFixed(4)}</span>}
        <span className="spacer" />
        <span className={`small ${capture.isCapturing ? "warn" : "muted"}`}>{capture.isCapturing ? "capturing" : "listening"}</span>
      </div>
      <LevelMeter value={capture.energy / scaleMax} marker={capture.threshold === null ? null : capture.threshold / scaleMax} tint={capture.isCapturing ? "red" : ""} />
      <SliderField label="trigger × floor" value={capture.triggerRatio} min={1.5} max={10} step={0.1} format={(v) => `${v.toFixed(1)}×`} onChange={(v) => { capture.triggerRatio = v; model.notify(); }} />
      {capture.noiseFloor === null && <p className="small muted">Calibrate first: 2 s of sitting still.</p>}
    </div>
  );
}

function Transcript() {
  const model = useModel();
  return (
    <div className="card">
      <div className="wrap" style={{ marginBottom: 8 }}>
        <h2>Transcript</h2>
        <span className="spacer" />
        <button className="btn sm" onClick={() => navigator.clipboard?.writeText(model.transcript)} disabled={!model.transcript}>copy</button>
        <button className="btn sm" onClick={() => model.clearDecoded()} disabled={model.decoded.length === 0}>clear</button>
      </div>
      {model.decoded.length === 0
        ? <div className="transcript empty">nothing yet</div>
        : (
          <div className="transcript">
            {model.decoded.map((w) => (
              <span key={w.id} className={w.prediction.accepted ? "" : "rejected"}>{decodedText(w)} </span>
            ))}
          </div>
        )}
      <p className="small muted" style={{ marginTop: 6 }}>Faded words were rejected.</p>
    </div>
  );
}

/** Where decoded words go: spoken aloud, typed into the front app, or both. */
function OutputPanel() {
  const model = useModel();
  const { settings, bridge } = model;
  const accessibility = bridge.info?.accessibility ?? false;
  const needsAccessibility = settings.types || settings.hotkeyEnabled;
  return (
    <div className="card">
      <h2>Output</h2>
      <div className="stack" style={{ gap: 10 }}>
        <div className="wrap">
          <label className="check"><input type="checkbox" checked={settings.speaks} onChange={(e) => model.updateSettings({ speaks: e.target.checked })} />speak</label>
          <label className="check"><input type="checkbox" checked={settings.types} onChange={(e) => model.updateSettings({ types: e.target.checked })} />type into front app</label>
          <label className="check"><input type="checkbox" checked={settings.hotkeyEnabled} onChange={(e) => model.updateSettings({ hotkeyEnabled: e.target.checked })} />Right Option from any app</label>
          <span className="spacer" />
          <button className="btn sm" onClick={() => model.speak(model.dataset.vocabulary[0] ?? "hello")} disabled={!settings.speaks}>test voice</button>
        </div>
        {settings.speaks && (
          <SliderField label="rate" value={settings.speechRate} min={0.5} max={1.6} step={0.05} onChange={(v) => model.updateSettings({ speechRate: v })} />
        )}
        {needsAccessibility && (
          bridge.state !== "connected"
            ? <div className="notice">Both of these go through the bridge, which isn't running.</div>
            : accessibility
              ? <p className="small muted">Accessibility is granted. Switch to another app and mouth a word.</p>
              : (
                <div className="notice wrap">
                  <span>These need Accessibility access for the terminal running the bridge.</span>
                  <button className="btn sm" onClick={() => bridge.requestAccessibility()}>open prompt</button>
                  <span>Restart the bridge after granting it.</span>
                </div>
              )
        )}
        {model.lastOutput && <p className="small muted">last: {model.lastOutput}</p>}
      </div>
    </div>
  );
}

function LastSegment() {
  const model = useModel();
  const last = model.decoded[model.decoded.length - 1];
  return (
    <div className="card">
      <h2>Last segment</h2>
      {last
        ? (
          <div className="stack" style={{ gap: 8 }}>
            <div className="ranked">
              {last.prediction.ranked.map((c) => (
                <RankedRow key={c.label} label={c.label} score={c.score} distance={c.distance} best={c.label === last.prediction.ranked[0].label} />
              ))}
            </div>
            <p className="small muted">confidence {last.prediction.confidence.toFixed(2)}, {last.prediction.accepted ? "accepted" : "rejected"}</p>
            <SignalPlot title="rotation" samples={model.lastSegment} channels={ROTATION} minScale={0.05} height={60} />
          </div>
        )
        : <p className="small muted">vote share and distance per word</p>}
    </div>
  );
}

function RankedRow({ label, score, distance, best }: { label: string; score: number; distance: number; best: boolean }) {
  return (
    <>
      <span>{label}</span>
      <LevelMeter value={score} tint={best ? "" : "gray"} />
      <span className="small mono muted" style={{ textAlign: "right" }}>{Number.isFinite(distance) ? distance.toFixed(2) : "∞"}</span>
    </>
  );
}
