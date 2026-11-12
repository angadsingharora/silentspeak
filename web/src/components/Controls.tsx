import { useState, type PointerEvent } from "react";

export function LevelMeter({ value, marker, tint = "" }: { value: number; marker?: number | null; tint?: "" | "blue" | "red" | "gray" }) {
  const clamp = (v: number) => `${Math.min(Math.max(v, 0), 1) * 100}%`;
  return (
    <div className="meter">
      <div className={`fill ${tint}`} style={{ width: clamp(value) }} />
      {marker !== undefined && marker !== null && <div className="marker" style={{ left: `calc(${clamp(marker)} - 1px)` }} />}
    </div>
  );
}

interface HoldProps {
  title: string;
  isCapturing: boolean;
  enabled: boolean;
  hint?: string;
  onBegin: () => void;
  onEnd: () => void;
}

/** Mouse/touch alternative to holding Space. */
export function HoldButton({ title, isCapturing, enabled, hint = "hold Space, or click and hold", onBegin, onEnd }: HoldProps) {
  const [pressed, setPressed] = useState(false);
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (!enabled || pressed) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setPressed(true);
    onBegin();
  };
  const up = () => {
    if (!pressed) return;
    setPressed(false);
    onEnd();
  };
  return (
    <div
      className={`hold ${isCapturing ? "capturing" : ""} ${enabled ? "" : "disabled"}`}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      role="button"
      aria-pressed={isCapturing}
    >
      <div className="title">{isCapturing ? "capturing" : title}</div>
      <div className="small muted">{isCapturing ? "release to finish" : hint}</div>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? "active" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="stepper">
      <span>{label}</span>
      <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>−</button>
      <span className="mono">{value}</span>
      <button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>+</button>
    </div>
  );
}

export function SliderField({ label, value, min, max, step, onChange, format = (v) => v.toFixed(2) }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="value mono">{format(value)}</span>
    </label>
  );
}
