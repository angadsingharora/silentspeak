import type { Screen } from "./model";
import { useModel } from "./useModel";
import { DecodeView } from "./components/DecodeView";
import { SensorsView } from "./components/SensorsView";
import { TrainView } from "./components/TrainView";

const SCREENS: { id: Screen; label: string }[] = [
  { id: "sensors", label: "Sensors" },
  { id: "train", label: "Train" },
  { id: "decode", label: "Decode" },
];

export function App() {
  const model = useModel();
  const { bridge } = model;
  const dot = bridge.state !== "connected" ? "red" : bridge.motion === "streaming" ? "green" : "orange";
  const status = bridge.state !== "connected"
    ? (bridge.state === "connecting" ? "Connecting to bridge…" : "Bridge not connected")
    : bridge.motion === "streaming"
      ? `${bridge.info?.simulated ? "Simulated" : "AirPods"} · ${Math.round(model.sampleRate)} Hz`
      : bridge.motion === "waiting" ? "Waiting for AirPods" : bridge.motion;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            <svg width="16" height="16" viewBox="0 0 32 32"><path d="M8 17q8-7 16 0" stroke="white" strokeWidth="3.5" fill="none" strokeLinecap="round" /></svg>
          </span>
          SilentSpeak
        </div>
        <nav className="nav">
          {SCREENS.map((s) => (
            <button key={s.id} className={model.screen === s.id ? "active" : ""} onClick={() => model.setScreen(s.id)}>{s.label}</button>
          ))}
        </nav>
        <span className="spacer" />
        <span className="badge mono"><span className={`dot ${dot}`} />{status}</span>
      </header>
      <main className="content">
        {model.screen === "sensors" && <SensorsView />}
        {model.screen === "train" && <TrainView />}
        {model.screen === "decode" && <DecodeView />}
      </main>
      {model.statusMessage && <div className="toast">{model.statusMessage}</div>}
    </div>
  );
}
