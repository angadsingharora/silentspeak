import { energy, type MotionSample } from "./motion";

export type CaptureMode = "hold" | "auto";

export const CAPTURE = {
  calibrationSeconds: 2,
  prerollSeconds: 0.3,
  hangoverSeconds: 0.35,
  maxAutoSeconds: 3,
  maxHoldSeconds: 6,
  gapSeconds: 1,
};

/**
 * Cuts the continuous motion stream into word-sized segments, either while a key is held
 * or automatically when motion energy rises above a calibrated noise floor.
 */
export class CaptureController {
  autoEnabled = false;
  triggerRatio = 3;

  isCapturing = false;
  isCalibrating = false;
  energy = 0;
  noiseFloor: number | null = null;

  onSegment: ((segment: MotionSample[]) => void) | null = null;
  onChange: (() => void) | null = null;

  private isManual = false;
  private buffer: MotionSample[] = [];
  private preroll: MotionSample[] = [];
  private calibration: number[] = [];
  private calibrationEnd: number | null = null;
  private quietSince: number | null = null;
  private lastT: number | null = null;
  private heldFrom = 0;

  get threshold(): number | null {
    return this.noiseFloor === null ? null : this.noiseFloor * this.triggerRatio;
  }

  setAutoEnabled(enabled: boolean): void {
    this.autoEnabled = enabled;
    if (!enabled && this.isCapturing && !this.isManual) this.finish();
  }

  begin(): void {
    if (this.isCapturing) return;
    this.isManual = true;
    this.isCapturing = true;
    this.buffer = [...this.preroll];
    this.heldFrom = this.buffer.length;
    this.onChange?.();
  }

  end(): void {
    if (!this.isCapturing || !this.isManual) return;
    this.finish();
  }

  calibrate(): void {
    this.calibration = [];
    this.calibrationEnd = null;
    this.isCalibrating = true;
    this.onChange?.();
  }

  ingest(sample: MotionSample): void {
    // A gap in the stream (bridge reconnect, AirPods dropout) makes everything
    // before it useless as context for what comes after.
    if (this.lastT !== null && Math.abs(sample.t - this.lastT) > CAPTURE.gapSeconds) {
      this.preroll = [];
      this.buffer = [];
      this.heldFrom = 0;
      this.quietSince = null;
    }
    this.lastT = sample.t;
    const e = energy(sample);
    this.energy = this.energy * 0.6 + e * 0.4;

    if (this.isCalibrating) {
      const end = this.calibrationEnd ?? sample.t + CAPTURE.calibrationSeconds;
      this.calibrationEnd = end;
      this.calibration.push(this.energy);
      if (sample.t >= end) {
        const sorted = [...this.calibration].sort((a, b) => a - b);
        this.noiseFloor = Math.max(sorted[Math.floor(sorted.length / 2)], 1e-4);
        this.isCalibrating = false;
      }
    }

    this.preroll.push(sample);
    const keepFrom = this.preroll.findIndex((s) => s.t >= sample.t - CAPTURE.prerollSeconds);
    if (keepFrom > 0) this.preroll.splice(0, keepFrom);

    const threshold = this.threshold;
    if (this.isCapturing) {
      this.buffer.push(sample);
      const duration = sample.t - (this.buffer[0]?.t ?? sample.t);
      if (this.isManual) {
        if (duration > CAPTURE.maxHoldSeconds) this.finish();
      } else if (threshold !== null) {
        if (this.energy < threshold * 0.7) {
          const since = this.quietSince ?? sample.t;
          this.quietSince = since;
          if (sample.t - since > CAPTURE.hangoverSeconds) this.finish();
        } else {
          this.quietSince = null;
        }
        if (this.isCapturing && duration > CAPTURE.maxAutoSeconds) this.finish();
      }
    } else if (this.autoEnabled && !this.isCalibrating && threshold !== null && this.energy > threshold) {
      this.isManual = false;
      this.isCapturing = true;
      this.quietSince = null;
      this.buffer = [...this.preroll];
    }
    this.onChange?.();
  }

  private finish(): void {
    const segment = this.buffer;
    const held = this.isManual ? segment.length - this.heldFrom : segment.length;
    this.buffer = [];
    this.isCapturing = false;
    this.isManual = false;
    this.quietSince = null;
    this.onChange?.();
    // A tap that captured nothing but pre-roll is not a word.
    if (segment.length < 4 || held < 4) return;
    if (segment[segment.length - 1].t - segment[0].t < 0.15) return;
    this.onSegment?.(segment);
  }
}
