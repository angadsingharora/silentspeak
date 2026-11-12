import AppKit
import Observation
import SilentSpeakCore
import UniformTypeIdentifiers

struct DecodedWord: Identifiable, Hashable {
    let id = UUID()
    var prediction: Prediction
    /// The text this word produced (its expansion, or the word itself).
    var output: String
    var text: String { prediction.accepted ? output : (prediction.best?.label ?? "?") }
}

@MainActor @Observable
final class AppModel {
    enum Screen: String, CaseIterable, Identifiable {
        case sensors = "Sensors"
        case train = "Train"
        case decode = "Decode"
        var id: String { rawValue }
        var symbol: String {
            switch self {
            case .sensors: "waveform.path.ecg"
            case .train: "square.stack.3d.up"
            case .decode: "text.bubble"
            }
        }
    }

    /// Right Option: the capture key that works from any app.
    static let hotkeyCode: UInt16 = 61
    static let hotkeyName = "Right ⌥"

    let motion = HeadphoneMotionService()
    let audio = AudioService()
    let transcriber = MicTranscriber()
    let capture = CaptureController()
    let recorder = SessionRecorder()
    let output = OutputController()

    var screen: Screen = .train {
        didSet { syncCaptureMode() }
    }

    // MARK: Training

    private(set) var dataset = TemplateStore.load()
    var selectedWord: String?
    var featureSet: FeatureSet = .all {
        didSet { rebuildClassifier() }
    }
    /// Neighbours in the k-NN vote. 1 reproduces plain nearest-template matching.
    var k = 3 {
        didSet { evaluation = nil }
    }
    private(set) var classifier: TemplateClassifier?
    private(set) var evaluation: Evaluation?
    private(set) var isEvaluating = false
    private(set) var lastTemplateID: Template.ID?
    private(set) var statusMessage: String?

    // MARK: Decoding

    var decodeMode: CaptureController.Mode = .hold {
        didSet { syncCaptureMode() }
    }
    var maxDistance: Double = 1.5
    var minConfidence: Double = 0.1
    /// Hold Right Option to capture even while another app is in front.
    var hotkeyEnabled = false
    private(set) var decoded: [DecodedWord] = []
    private(set) var lastSegment: [MotionSample] = []

    @ObservationIgnored private var keyMonitor: Any?
    @ObservationIgnored private var hotkeyMonitors: [Any] = []
    @ObservationIgnored private var started = false

    init() {
        selectedWord = dataset.vocabulary.first
        rebuildClassifier()
    }

    func start() {
        guard !started else { return }
        started = true
        motion.onSample = { [weak self] sample in self?.ingest(sample) }
        capture.onSegment = { [weak self] segment in self?.handleSegment(segment) }
        motion.start()
        audio.refreshDevices()
        installKeyMonitor()
        installHotkeyMonitors()
    }

    private func ingest(_ sample: MotionSample) {
        capture.ingest(sample)
        recorder.record(sample)
    }

    private func syncCaptureMode() {
        capture.autoEnabled = screen == .decode && decodeMode == .auto
    }

    private func handleSegment(_ segment: [MotionSample]) {
        lastSegment = segment
        switch screen {
        case .train:
            guard let word = selectedWord else { return }
            addTemplate(Template(label: word, samples: segment))
            recorder.logEvent(segment, kind: "train", label: word, confidence: nil)
        case .decode:
            guard let classifier else { return }
            let prediction = classifier.predict(segment, k: k, maxDistance: maxDistance, minConfidence: minConfidence)
            let text = prediction.best.map { dataset.output(for: $0.label) } ?? ""
            decoded.append(DecodedWord(prediction: prediction, output: text))
            if prediction.accepted { output.emit(text) }
            recorder.logEvent(segment, kind: prediction.accepted ? "decode" : "reject",
                              label: prediction.best?.label ?? "", confidence: prediction.confidence)
        case .sensors:
            recorder.logEvent(segment, kind: "segment", label: recorder.prompt, confidence: nil)
        }
    }

    // MARK: Space bar = hold to capture (in-app)

    private func installKeyMonitor() {
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp]) { [weak self] event in
            guard event.keyCode == 49 else { return event }
            let isDown = event.type == .keyDown
            let isRepeat = isDown && event.isARepeat
            let consumed = MainActor.assumeIsolated { () -> Bool in
                guard let self, self.spaceCapturesMotion else { return false }
                if !isDown {
                    self.capture.end()
                } else if !isRepeat {
                    self.capture.begin()
                }
                return true
            }
            return consumed ? nil : event
        }
    }

    private var spaceCapturesMotion: Bool {
        // Let text fields keep the space bar.
        if NSApp.keyWindow?.firstResponder is NSText { return false }
        switch screen {
        case .train: return selectedWord != nil
        case .decode: return decodeMode == .hold && classifier != nil
        case .sensors: return recorder.isRecording
        }
    }

    // MARK: Right Option = hold to capture from any app

    private func installHotkeyMonitors() {
        let local = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { [weak self] event in
            MainActor.assumeIsolated { self?.handleHotkey(event) }
            return event
        }
        // Delivered only once the user grants Accessibility (or Input Monitoring) access.
        let global = NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged) { [weak self] event in
            MainActor.assumeIsolated { self?.handleHotkey(event) }
        }
        hotkeyMonitors = [local, global].compactMap { $0 }
    }

    private func handleHotkey(_ event: NSEvent) {
        guard hotkeyEnabled, event.keyCode == Self.hotkeyCode else { return }
        guard screen == .decode, decodeMode == .hold, classifier != nil else { return }
        if event.modifierFlags.contains(.option) {
            capture.begin()
        } else {
            capture.end()
        }
    }

    // MARK: Dataset editing

    func templates(for word: String) -> [Template] {
        dataset.templates(for: word)
    }

    func addWord(_ raw: String) {
        let word = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !word.isEmpty, !dataset.vocabulary.contains(word) else { return }
        dataset.vocabulary.append(word)
        selectedWord = word
        persist()
    }

    func removeWord(_ word: String) {
        dataset.vocabulary.removeAll { $0 == word }
        dataset.templates.removeAll { $0.label == word }
        dataset.expansions[word] = nil
        if selectedWord == word { selectedWord = dataset.vocabulary.first }
        persist()
    }

    func expansion(for word: String) -> String {
        dataset.expansions[word] ?? ""
    }

    func setExpansion(_ text: String, for word: String) {
        let trimmed = text.trimmingCharacters(in: .newlines)
        dataset.expansions[word] = trimmed.isEmpty ? nil : trimmed
        TemplateStore.save(dataset)
    }

    func addTemplate(_ template: Template) {
        dataset.templates.append(template)
        lastTemplateID = template.id
        persist()
    }

    func deleteTemplate(_ id: Template.ID) {
        dataset.templates.removeAll { $0.id == id }
        persist()
    }

    private func persist() {
        TemplateStore.save(dataset)
        rebuildClassifier()
    }

    private func rebuildClassifier() {
        classifier = TemplateClassifier(templates: dataset.templates, featureSet: featureSet)
        evaluation = nil
    }

    func evaluate() {
        guard !isEvaluating else { return }
        isEvaluating = true
        let templates = dataset.templates
        let featureSet = featureSet
        let k = k
        Task {
            let result = await Task.detached(priority: .userInitiated) {
                Evaluation.run(templates: templates, featureSet: featureSet, k: k)
            }.value
            self.evaluation = result
            self.isEvaluating = false
        }
    }

    // MARK: Import / export

    func exportDataset() {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.json]
        panel.nameFieldStringValue = "silentspeak-dataset.json"
        panel.title = "Export SilentSpeak Dataset"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try TemplateStore.save(dataset, to: url)
            statusMessage = "Exported \(dataset.templates.count) takes to \(url.lastPathComponent)."
        } catch {
            statusMessage = "Export failed: \(error.localizedDescription)"
        }
    }

    /// Imports a dataset file. `replace` swaps the whole training set; otherwise words
    /// and takes are merged into the current one.
    func importDataset(replace: Bool) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.json]
        panel.title = replace ? "Replace Dataset" : "Merge Dataset"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            let incoming = try TemplateStore.load(from: url)
            if replace {
                dataset = incoming
            } else {
                dataset.merge(incoming)
            }
            if selectedWord.map({ !dataset.vocabulary.contains($0) }) ?? true {
                selectedWord = dataset.vocabulary.first
            }
            persist()
            statusMessage = "\(replace ? "Replaced with" : "Merged") \(incoming.templates.count) takes across \(incoming.vocabulary.count) words."
        } catch {
            statusMessage = "Import failed: \(error.localizedDescription)"
        }
    }

    // MARK: Decode transcript

    var transcript: String {
        decoded.filter(\.prediction.accepted).map(\.text).joined(separator: " ")
    }

    func clearDecoded() {
        decoded.removeAll()
        lastSegment = []
    }

    // MARK: Mic

    func toggleMic() async {
        if audio.isRunning {
            transcriber.stop()
            audio.stop()
        } else {
            await audio.start()
            if audio.isRunning { await transcriber.start(sink: audio.sink) }
        }
    }
}
