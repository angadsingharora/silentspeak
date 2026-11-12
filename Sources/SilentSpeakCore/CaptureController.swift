import Foundation
import Observation

/// Cuts the continuous motion stream into word-sized segments, either while Space is held
/// or automatically when motion energy rises above a calibrated noise floor.
@MainActor @Observable
public final class CaptureController {
    public enum Mode: String, CaseIterable, Identifiable {
        case hold = "Hold Space"
        case auto = "Auto-detect"
        public var id: String { rawValue }
    }

    public static let calibrationSeconds: TimeInterval = 2
    public static let prerollSeconds: TimeInterval = 0.3
    public static let hangoverSeconds: TimeInterval = 0.35
    public static let maxAutoSeconds: TimeInterval = 3
    public static let maxHoldSeconds: TimeInterval = 6
    public static let gapSeconds: TimeInterval = 1

    public var autoEnabled = false {
        didSet { if !autoEnabled, isCapturing, !isManual { finish() } }
    }
    public var triggerRatio: Double = 3

    public private(set) var isCapturing = false
    public private(set) var isCalibrating = false
    public private(set) var energy: Double = 0
    public private(set) var noiseFloor: Double?

    public var threshold: Double? { noiseFloor.map { $0 * triggerRatio } }

    public var onSegment: (([MotionSample]) -> Void)?

    @ObservationIgnored private var isManual = false
    @ObservationIgnored private var buffer: [MotionSample] = []
    @ObservationIgnored private var preroll: [MotionSample] = []
    @ObservationIgnored private var calibration: [Double] = []
    @ObservationIgnored private var calibrationEnd: TimeInterval?
    @ObservationIgnored private var quietSince: TimeInterval?
    @ObservationIgnored private var lastT: TimeInterval?
    @ObservationIgnored private var heldFrom = 0

    public init() {}

    public func begin() {
        guard !isCapturing else { return }
        isManual = true
        isCapturing = true
        buffer = preroll
        heldFrom = buffer.count
    }

    public func end() {
        guard isCapturing, isManual else { return }
        finish()
    }

    public func calibrate() {
        calibration = []
        calibrationEnd = nil
        isCalibrating = true
    }

    public func ingest(_ sample: MotionSample) {
        // A gap in the stream (AirPods dropout) makes everything before it useless
        // as context for what comes after.
        if let lastT, abs(sample.t - lastT) > Self.gapSeconds {
            preroll = []
            buffer = []
            heldFrom = 0
            quietSince = nil
        }
        lastT = sample.t
        let e = MotionFeatures.energy(sample)
        energy = energy * 0.6 + e * 0.4

        if isCalibrating {
            let end = calibrationEnd ?? sample.t + Self.calibrationSeconds
            calibrationEnd = end
            calibration.append(energy)
            if sample.t >= end {
                let sorted = calibration.sorted()
                noiseFloor = max(sorted[sorted.count / 2], 1e-4)
                isCalibrating = false
            }
        }

        preroll.append(sample)
        if let keepFrom = preroll.firstIndex(where: { $0.t >= sample.t - Self.prerollSeconds }), keepFrom > 0 {
            preroll.removeFirst(keepFrom)
        }

        if isCapturing {
            buffer.append(sample)
            let duration = sample.t - (buffer.first?.t ?? sample.t)
            if isManual {
                if duration > Self.maxHoldSeconds { finish() }
            } else if let threshold {
                if energy < threshold * 0.7 {
                    let since = quietSince ?? sample.t
                    quietSince = since
                    if sample.t - since > Self.hangoverSeconds { finish() }
                } else {
                    quietSince = nil
                }
                if duration > Self.maxAutoSeconds { finish() }
            }
        } else if autoEnabled, !isCalibrating, let threshold, energy > threshold {
            isManual = false
            isCapturing = true
            quietSince = nil
            buffer = preroll
        }
    }

    private func finish() {
        let segment = buffer
        let held = isManual ? segment.count - heldFrom : segment.count
        buffer = []
        isCapturing = false
        isManual = false
        quietSince = nil
        // A tap that captured nothing but pre-roll is not a word.
        guard segment.count >= 4, held >= 4, let first = segment.first, let last = segment.last, last.t - first.t >= 0.15 else { return }
        onSegment?(segment)
    }
}
