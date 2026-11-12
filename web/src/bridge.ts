import { sampleFromWire, type MotionSample } from "./engine/motion";

export type BridgeState = "disconnected" | "connecting" | "connected";
export type MotionState = "unknown" | "waiting" | "streaming" | "unsupported" | "denied" | "error";

export interface BridgeInfo {
  simulated: boolean;
  typing: boolean;
  accessibility: boolean;
}

const PORT_KEY = "silentspeak.bridge.port";
export const DEFAULT_PORT = 8765;

/**
 * Client for silentspeak-bridge, the native helper that streams AirPods motion over a
 * loopback WebSocket. Reconnects on its own; everything it learns is exposed as fields
 * and reported through the callbacks.
 */
export class BridgeClient {
  state: BridgeState = "disconnected";
  motion: MotionState = "unknown";
  motionMessage: string | null = null;
  info: BridgeInfo | null = null;
  port: number;

  onSample: ((sample: MotionSample) => void) | null = null;
  onKey: ((key: string, down: boolean) => void) | null = null;
  onTyped: ((ok: boolean, accessibility: boolean) => void) | null = null;
  onChange: (() => void) | null = null;

  private socket: WebSocket | null = null;
  private retryTimer: number | null = null;
  private retryDelay = 1000;
  private wanted = false;

  constructor() {
    let port = DEFAULT_PORT;
    try {
      const saved = Number(localStorage.getItem(PORT_KEY));
      if (Number.isInteger(saved) && saved > 0 && saved < 65536) port = saved;
    } catch { /* storage unavailable */ }
    this.port = port;
  }

  get url(): string {
    return `ws://127.0.0.1:${this.port}`;
  }

  setPort(port: number): void {
    if (!Number.isInteger(port) || port <= 0 || port >= 65536) return;
    this.port = port;
    try { localStorage.setItem(PORT_KEY, String(port)); } catch { /* ignore */ }
    if (this.wanted) {
      this.disconnect();
      this.connect();
    }
  }

  connect(): void {
    this.wanted = true;
    if (this.socket) return;
    this.state = "connecting";
    this.onChange?.();
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.state = "connected";
      this.retryDelay = 1000;
      this.onChange?.();
    };
    socket.onmessage = (event) => this.handle(String(event.data));
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      this.state = "disconnected";
      this.motion = "unknown";
      this.info = null;
      this.onChange?.();
      if (this.wanted) this.scheduleRetry();
    };
    socket.onerror = () => { /* onclose follows */ };
  }

  disconnect(): void {
    this.wanted = false;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.state = "disconnected";
    this.motion = "unknown";
    this.info = null;
    this.onChange?.();
  }

  send(message: Record<string, unknown>): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  /** Asks the bridge to type into the frontmost app. Resolves through onTyped. */
  type(text: string): boolean {
    return this.send({ type: "type", text });
  }

  requestAccessibility(): void {
    this.send({ type: "requestAccessibility" });
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null || !this.wanted) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.socket = null;
      this.connect();
    }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 1.6, 5000);
  }

  private handle(raw: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    switch (message.type) {
      case "motion":
        if (Array.isArray(message.s)) this.onSample?.(sampleFromWire(message.s as number[]));
        break;
      case "status":
        this.motion = (message.motion as MotionState) ?? "unknown";
        this.motionMessage = typeof message.message === "string" ? message.message : null;
        this.onChange?.();
        break;
      case "hello":
        this.info = {
          simulated: Boolean(message.simulated),
          typing: message.typing !== false,
          accessibility: Boolean(message.accessibility),
        };
        this.onChange?.();
        break;
      case "key":
        this.onKey?.(String(message.key), Boolean(message.down));
        break;
      case "typed":
        if (this.info) this.info = { ...this.info, accessibility: Boolean(message.accessibility) };
        this.onTyped?.(Boolean(message.ok), Boolean(message.accessibility));
        this.onChange?.();
        break;
      default:
        break;
    }
  }
}
