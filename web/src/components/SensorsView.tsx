import { useEffect, useRef, useState } from "react";
import { LevelMeter, SliderField } from "./Controls";
import { useModel } from "../useModel";
import { ACCELERATION, ATTITUDE, ROTATION, SignalPlot } from "./SignalPlot";

export function SensorsView() {
  const model = useModel();
  const { bridge } = model;
  const span: [number, number] | undefined = model.latest ? [model.latest.t - 8, model.latest.t] : undefined;
  const [port, setPort] = useState(String(bridge.port));

  return (
    <div className="stack">
      <div className="row">
        <div className="card">
          <h2>Bridge</h2>
          <div className="stack" style={{ gap: 8 }}>
            <div>{bridge.state} <span className="muted mono">{bridge.url}</span></div>
            {bridge.info && (
              <div className="small muted">
                {bridge.info.simulated ? "simulated motion, " : ""}
                typing {bridge.info.typing ? "on" : "off"}, accessibility {bridge.info.accessibility ? "granted" : "not granted"}
              </div>
            )}
            <div className="wrap">
              <label className="field">
                port
                <input type="number" value={port} onChange={(e) => setPort(e.target.value)} style={{ width: 90 }} />
              </label>
              <button className="btn sm" onClick={() => bridge.setPort(Number(port))}>set</button>
              {bridge.state === "disconnected"
                ? <button className="btn sm" onClick={() => bridge.connect()}>connect</button>
                : <button className="btn sm" onClick={() => bridge.disconnect()}>disconnect</button>}
            </div>
            {bridge.state !== "connected" && (
              <div className="notice">
                Run the bridge on this Mac; the page connects by itself.
                <pre className="code">swift run silentspeak-bridge --origin {location.origin}</pre>
                <code>--simulate</code> fakes the AirPods.
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <h2>Motion</h2>
          <div className="stack mono" style={{ gap: 4 }}>
            <div>{bridge.motion}{bridge.motionMessage ? <span className="muted"> — {bridge.motionMessage}</span> : null}</div>
            <div>{model.sampleRate.toFixed(1)} Hz, {model.sampleCount} samples</div>
            {model.latest && <div>gravity {model.latest.gx.toFixed(2)}, {model.latest.gy.toFixed(2)}, {model.latest.gz.toFixed(2)}</div>}
            {bridge.motion === "waiting" && (
              <p className="small muted" style={{ fontFamily: "inherit" }}>AirPods need to be the Mac's audio output.</p>
            )}
          </div>
        </div>
      </div>

      <CameraCard />

      <div className="card">
        <h2>Last 8 s</h2>
        <div className="stack" style={{ gap: 12 }}>
          <SignalPlot title="acceleration (g)" samples={model.history} channels={ACCELERATION} span={span} minScale={0.01} />
          <SignalPlot title="rotation (rad/s)" samples={model.history} channels={ROTATION} span={span} minScale={0.05} />
          <SignalPlot title="attitude (rad)" samples={model.history} channels={ATTITUDE} span={span} minScale={0.1} />
        </div>
      </div>

      <p className="small muted">Session recording to CSV/audio is only in the native app.</p>
    </div>
  );
}

/** Webcam preview with the lip landmarks drawn over it, plus the mouth gate controls. */
function CameraCard() {
  const model = useModel();
  const cam = model.camera;
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    cam.video.style.width = "100%";
    cam.video.style.display = "block";
    el.prepend(cam.video);
    return () => { cam.video.remove(); };
  }, [cam]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const w = c.clientWidth, h = c.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = cam.gate.isOpen ? "#c0392b" : "#fff";
    for (const p of cam.lipPoints) ctx.fillRect(p.x * w - 1, p.y * h - 1, 2, 2);
  });

  const scale = Math.max(cam.gate.threshold * 2, 0.5);
  return (
    <div className="card">
      <h2>Camera</h2>
      <div className="row">
        <div ref={holder} className="preview" style={{ flex: "0 0 320px", position: "relative", background: "var(--soft)", minHeight: 180 }}>
          <canvas ref={canvas} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <div className="wrap">
            {cam.isOn
              ? <button className="btn sm" onClick={() => model.stopCamera()}>stop</button>
              : <button className="btn sm" onClick={() => model.startCamera()}>start camera</button>}
            <span className="mono">{cam.status}{cam.status === "tracking" ? `, ${cam.fps} fps` : ""}</span>
            {cam.error && <span className="small warn">{cam.error}</span>}
          </div>
          <LevelMeter value={cam.gate.speed / scale} marker={cam.gate.threshold / scale} tint={cam.gate.isOpen ? "red" : ""} />
          <SliderField label="sensitivity" value={model.settings.gateThreshold} min={0.3} max={4} step={0.1} format={(v) => v.toFixed(1)} onChange={(v) => model.updateSettings({ gateThreshold: v })} />
          <label className="check">
            <input type="checkbox" checked={model.settings.lipGate} onChange={(e) => model.updateSettings({ lipGate: e.target.checked })} />
            mouth movement starts and stops a capture
          </label>
          <p className="small muted">
            Lip shapes from the face model become extra channels for matching (the "lips" box in Evaluate). Runs in the page; nothing is uploaded. Without AirPods the camera is the only signal, which still works.
          </p>
        </div>
      </div>
    </div>
  );
}
