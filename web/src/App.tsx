import type { Screen } from "./model";
import { useModel } from "./useModel";
import { DecodeView } from "./components/DecodeView";
import { SensorsView } from "./components/SensorsView";
import { TrainView } from "./components/TrainView";

const SCREENS: { id: Screen; label: string }[] = [
  { id: "sensors", label: "sensors" },
  { id: "train", label: "train" },
  { id: "decode", label: "decode" },
];

export function App() {
  const model = useModel();
  const { bridge } = model;
  const airpods = bridge.state === "connected" && bridge.motion === "streaming";
  const camera = model.cameraTracking;
  const tone = airpods || camera ? "live" : bridge.state === "connected" ? "" : "bad";
  const parts: string[] = [];
  if (airpods) parts.push(`${bridge.info?.simulated ? "simulated" : "AirPods"}, ${Math.round(model.sampleRate)} Hz`);
  if (camera) parts.push(`camera, ${model.camera.fps} fps`);
  const status = parts.length
    ? parts.join(" + ")
    : bridge.state !== "connected"
      ? (bridge.state === "connecting" ? "connecting to bridge" : "bridge not running, camera off")
      : bridge.motion === "waiting" ? "waiting for AirPods" : bridge.motion;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">silentspeak</div>
        <nav className="nav">
          {SCREENS.map((s) => (
            <button key={s.id} className={model.screen === s.id ? "active" : ""} onClick={() => model.setScreen(s.id)}>{s.label}</button>
          ))}
        </nav>
        <span className="spacer" />
        <span className={`status ${tone}`}>{status}</span>
      </header>
      <main>
        {model.screen === "sensors" && <SensorsView />}
        {model.screen === "train" && <TrainView />}
        {model.screen === "decode" && <DecodeView />}
      </main>
      {model.statusMessage && <div className="toast">{model.statusMessage}</div>}
    </div>
  );
}
