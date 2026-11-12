import { useState } from "react";
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
            <div>Status: <b>{bridge.state}</b> <span className="muted mono">{bridge.url}</span></div>
            {bridge.info && (
              <div className="small muted">
                {bridge.info.simulated ? "Simulated motion (no AirPods). " : ""}
                Typing {bridge.info.typing ? "enabled" : "disabled"}; Accessibility {bridge.info.accessibility ? "granted" : "not granted"}.
              </div>
            )}
            <div className="wrap">
              <label className="field">
                Port
                <input type="number" value={port} onChange={(e) => setPort(e.target.value)} style={{ width: 90 }} />
              </label>
              <button className="btn sm" onClick={() => bridge.setPort(Number(port))}>Apply</button>
              {bridge.state === "disconnected"
                ? <button className="btn sm primary" onClick={() => bridge.connect()}>Connect</button>
                : <button className="btn sm" onClick={() => bridge.disconnect()}>Disconnect</button>}
            </div>
            {bridge.state !== "connected" && (
              <div className="notice info small">
                Start the bridge on this Mac, then this page connects on its own:
                <pre className="code" style={{ marginTop: 6 }}>swift run silentspeak-bridge</pre>
                <span>Add <code>--simulate</code> to try the app without AirPods.</span>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <h2>AirPods motion</h2>
          <div className="stack mono" style={{ gap: 6 }}>
            <div>Status: <b>{bridge.motion}</b>{bridge.motionMessage ? <span className="muted"> · {bridge.motionMessage}</span> : null}</div>
            <div>Sample rate: {model.sampleRate.toFixed(1)} Hz</div>
            <div>Samples: {model.sampleCount}</div>
            {model.latest && <div>Gravity: {model.latest.gx.toFixed(2)}, {model.latest.gy.toFixed(2)}, {model.latest.gz.toFixed(2)}</div>}
            {bridge.motion === "waiting" && (
              <p className="small muted" style={{ fontFamily: "inherit" }}>Put in AirPods Pro and make sure they're the active output on this Mac.</p>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Live motion (last 8 s)</h2>
        <div className="stack" style={{ gap: 12 }}>
          <SignalPlot title="User acceleration (g)" samples={model.history} channels={ACCELERATION} span={span} minScale={0.01} />
          <SignalPlot title="Rotation rate (rad/s)" samples={model.history} channels={ROTATION} span={span} minScale={0.05} />
          <SignalPlot title="Attitude (rad)" samples={model.history} channels={ATTITUDE} span={span} minScale={0.1} />
        </div>
      </div>

      <div className="card soft small muted">
        Experiment recordings (motion CSV + audio + labelled events) are a feature of the native macOS app in this repo. The web app keeps everything in your browser and in exported dataset files.
      </div>
    </div>
  );
}
