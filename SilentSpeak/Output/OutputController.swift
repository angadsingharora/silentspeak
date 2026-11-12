import AppKit
import AVFoundation
import ApplicationServices
import Observation

/// Turns a decoded word into something useful: speech through the AirPods, keystrokes in
/// whichever app is in front, or both. This is what makes SilentSpeak an input method
/// rather than only an experiment.
@MainActor @Observable
final class OutputController {
    /// Speak each accepted word aloud.
    var speaks = false
    /// Type each accepted word (plus a space) into the frontmost app. Needs Accessibility access.
    var types = false
    /// Speech rate, 0…1 (AVSpeechUtterance range).
    var speechRate: Float = AVSpeechUtteranceDefaultSpeechRate

    private(set) var accessibilityTrusted = AXIsProcessTrusted()
    private(set) var lastOutput = ""
    private(set) var typedCount = 0

    @ObservationIgnored private let synthesizer = AVSpeechSynthesizer()
    @ObservationIgnored private var activationObserver: Any?

    init() {
        activationObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.refreshPermissions() }
        }
    }

    func refreshPermissions() {
        accessibilityTrusted = AXIsProcessTrusted()
    }

    /// Opens the system prompt that adds SilentSpeak to Privacy & Security › Accessibility.
    func requestAccessibility() {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        accessibilityTrusted = AXIsProcessTrustedWithOptions(options)
    }

    func emit(_ text: String) {
        lastOutput = text
        if speaks { speak(text) }
        if types { type(text + " ") }
    }

    func speak(_ text: String) {
        synthesizer.stopSpeaking(at: .immediate)
        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = speechRate
        synthesizer.speak(utterance)
    }

    /// Posts `text` as synthetic key events to the frontmost app. Skipped while SilentSpeak
    /// itself is in front, so the transcript never types into its own windows.
    func type(_ text: String) {
        refreshPermissions()
        guard accessibilityTrusted, !NSApp.isActive else { return }
        let source = CGEventSource(stateID: .combinedSessionState)
        let scalars = Array(text.utf16)
        // keyboardSetUnicodeString handles at most ~20 UTF-16 units per event.
        for start in stride(from: 0, to: scalars.count, by: 20) {
            var chunk = Array(scalars[start..<min(start + 20, scalars.count)])
            for keyDown in [true, false] {
                guard let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: keyDown) else { continue }
                event.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: &chunk)
                event.post(tap: .cghidEventTap)
            }
        }
        typedCount += 1
    }
}
