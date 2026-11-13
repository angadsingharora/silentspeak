import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { lipVector, MouthGate } from "./engine/face";

export type CameraStatus = "off" | "loading" | "tracking" | "noface" | "error";

export interface Point { x: number; y: number }

/**
 * Webcam + MediaPipe Face Landmarker. Produces a lip vector per video frame and feeds
 * the mouth gate. Everything runs in the page; no frames leave the machine.
 */
export class FaceTracker {
  status: CameraStatus = "off";
  error: string | null = null;
  fps = 0;
  latest: number[] | null = null;
  /** performance.now() of the latest lip vector, ms. */
  latestAt = 0;
  /** Normalised lip landmarks of the last frame, for the preview overlay. */
  lipPoints: Point[] = [];
  readonly video: HTMLVideoElement;
  readonly gate = new MouthGate();

  onFrame: ((t: number, lips: number[]) => void) | null = null;
  onChange: (() => void) | null = null;

  private landmarker: FaceLandmarker | null = null;
  private stream: MediaStream | null = null;
  private running = false;
  private lastVideoTime = -1;
  private frameTimes: number[] = [];
  private lipIndices: number[] = [];

  constructor() {
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.autoplay = true;
  }

  get isOn(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.error = null;
    this.setStatus("loading");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser has no camera access.");
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user", frameRate: { ideal: 30 } },
        audio: false,
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      if (!this.landmarker) this.landmarker = await this.createLandmarker();
      if (!this.running) throw new Error("stopped");
      this.gate.reset();
      this.setStatus("noface");
      this.schedule();
    } catch (e) {
      this.running = false;
      this.releaseStream();
      if ((e as Error)?.message !== "stopped") {
        this.error = e instanceof Error ? e.message : String(e);
        this.setStatus("error");
      } else {
        this.setStatus("off");
      }
    }
  }

  stop(): void {
    this.running = false;
    this.releaseStream();
    this.gate.reset();
    this.latest = null;
    this.lipPoints = [];
    this.fps = 0;
    this.setStatus("off");
  }

  private async createLandmarker(): Promise<FaceLandmarker> {
    const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`);
    const modelAssetPath = `${import.meta.env.BASE_URL}mediapipe/face_landmarker.task`;
    const options = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath, delegate },
      runningMode: "VIDEO" as const,
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: false,
    });
    const indices = new Set<number>();
    for (const c of FaceLandmarker.FACE_LANDMARKS_LIPS) { indices.add(c.start); indices.add(c.end); }
    this.lipIndices = [...indices];
    try {
      return await FaceLandmarker.createFromOptions(fileset, options("GPU"));
    } catch {
      return await FaceLandmarker.createFromOptions(fileset, options("CPU"));
    }
  }

  private schedule(): void {
    if (!this.running) return;
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => this.tick());
    else requestAnimationFrame(() => this.tick());
  }

  private tick(): void {
    if (!this.running || !this.landmarker) return;
    const now = performance.now();
    if (this.video.currentTime !== this.lastVideoTime && this.video.readyState >= 2) {
      this.lastVideoTime = this.video.currentTime;
      let result;
      try {
        result = this.landmarker.detectForVideo(this.video, now);
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
        this.setStatus("error");
        this.stop();
        return;
      }
      const blendshapes = result.faceBlendshapes?.[0]?.categories;
      if (blendshapes && blendshapes.length) {
        const lips = lipVector(blendshapes);
        const t = now / 1000;
        this.latest = lips;
        this.latestAt = now;
        const points = result.faceLandmarks?.[0];
        this.lipPoints = points ? this.lipIndices.map((i) => ({ x: points[i].x, y: points[i].y })) : [];
        this.frameTimes.push(now);
        this.frameTimes = this.frameTimes.filter((f) => f > now - 1000);
        this.fps = this.frameTimes.length;
        this.gate.ingest(lips, t);
        if (this.status !== "tracking") this.setStatus("tracking");
        this.onFrame?.(t, lips);
        this.onChange?.();
      } else {
        this.lipPoints = [];
        if (this.status !== "noface") {
          this.gate.reset();
          this.setStatus("noface");
        }
      }
    }
    this.schedule();
  }

  private releaseStream(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.video.srcObject = null;
  }

  private setStatus(status: CameraStatus): void {
    this.status = status;
    this.onChange?.();
  }
}
