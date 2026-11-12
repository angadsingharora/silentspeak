import { useEffect, useRef } from "react";
import type { MotionSample } from "../engine/motion";

export interface Channel {
  name: string;
  color: string;
  key: keyof MotionSample;
}

export const ACCELERATION: Channel[] = [
  { name: "x", color: "#ef4444", key: "ax" },
  { name: "y", color: "#22c55e", key: "ay" },
  { name: "z", color: "#3b82f6", key: "az" },
];
export const ROTATION: Channel[] = [
  { name: "x", color: "#ef4444", key: "rx" },
  { name: "y", color: "#22c55e", key: "ry" },
  { name: "z", color: "#3b82f6", key: "rz" },
];
export const ATTITUDE: Channel[] = [
  { name: "pitch", color: "#f59e0b", key: "pitch" },
  { name: "roll", color: "#a855f7", key: "roll" },
  { name: "yaw", color: "#14b8a6", key: "yaw" },
];

interface Props {
  title?: string;
  samples: MotionSample[];
  channels: Channel[];
  /** Visible time span [start, end]; defaults to the extent of `samples`. */
  span?: [number, number];
  minScale?: number;
  height?: number;
}

/** Multi-channel line plot drawn on a canvas so it keeps up at sensor rate. */
export function SignalPlot({ title, samples, channels, span, minScale = 0.02, height = 90 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const range: [number, number] = span ?? [samples[0]?.t ?? 0, samples[samples.length - 1]?.t ?? 1];
  const visible = samples.filter((s) => s.t >= range[0] && s.t <= range[1]);
  let scale = minScale;
  for (const c of channels) for (const s of visible) scale = Math.max(scale, Math.abs(s[c.key]));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const mid = height / 2;
    ctx.strokeStyle = "rgba(128,128,128,0.35)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(width, mid);
    ctx.stroke();

    const spanWidth = Math.max(range[1] - range[0], 1e-3);
    ctx.lineWidth = 1.2;
    for (const c of channels) {
      ctx.strokeStyle = c.color;
      ctx.beginPath();
      visible.forEach((s, i) => {
        const x = ((s.t - range[0]) / spanWidth) * width;
        const y = mid - (s[c.key] / scale) * (mid - 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  });

  return (
    <div className="plot">
      {title !== undefined && (
        <div className="legend">
          <span className="title">{title}</span>
          {channels.map((c) => (
            <span key={c.name} style={{ color: c.color }}>● {c.name}</span>
          ))}
          <span className="spacer" />
          <span className="muted mono">±{scale.toFixed(3)}</span>
        </div>
      )}
      <canvas ref={canvasRef} style={{ height }} />
    </div>
  );
}
