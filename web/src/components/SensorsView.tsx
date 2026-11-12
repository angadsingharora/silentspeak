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
