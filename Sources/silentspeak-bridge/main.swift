import AppKit
import ApplicationServices
import CoreMotion
import Foundation
import Network
import SilentSpeakCore

// silentspeak-bridge: the one native piece the web app needs.
//
// Streams AirPods head-motion samples over a loopback WebSocket, relays the
// Right ⌥ push-to-mouth key, and types text into the frontmost app on request.
//
//   silentspeak-bridge [--port 8765] [--origin https://your-app.vercel.app]... [--simulate] [--no-type]
//
// Only loopback is bound. Browser pages are admitted by Origin: localhost dev
// servers always, plus any --origin you add. Non-browser clients (no Origin) are admitted.

struct Options {
    var port: UInt16 = 8765
    var origins: [String] = []
    var simulate = false
    var typing = true
}

func usage() -> Never {
    FileHandle.standardError.write(Data("""
    usage: silentspeak-bridge [--port N] [--origin URL]... [--simulate] [--no-type]

    """.utf8))
    exit(2)
}

func parse(_ args: [String]) -> Options {
    var options = Options()
    var it = args.makeIterator()
    while let arg = it.next() {
        switch arg {
        case "--port", "-p":
            guard let v = it.next(), let port = UInt16(v) else { usage() }
            options.port = port
        case "--origin", "-o":
            guard let v = it.next() else { usage() }
            options.origins.append(v.trimmingCharacters(in: CharacterSet(charactersIn: "/")).lowercased())
        case "--simulate": options.simulate = true
        case "--no-type": options.typing = false
        default: usage()
        }
    }
    return options
}

func log(_ message: String) {
    let stamp = Date().formatted(date: .omitted, time: .standard)
    print("[\(stamp)] \(message)")
    fflush(stdout)
}

// MARK: - Wire format

enum Wire {
    static func encode(_ object: [String: Any]) -> Data? {
        try? JSONSerialization.data(withJSONObject: object)
    }

    static func motion(_ s: MotionSample) -> Data? {
        encode(["type": "motion",
                "s": [s.t, s.ax, s.ay, s.az, s.rx, s.ry, s.rz, s.pitch, s.roll, s.yaw, s.gx, s.gy, s.gz]])
    }

    static func status(_ state: String, message: String? = nil) -> Data? {
        var object: [String: Any] = ["type": "status", "motion": state]
        if let message { object["message"] = message }
        return encode(object)
    }
}

// MARK: - WebSocket server

final class Server {
    private let options: Options
    private let queue = DispatchQueue(label: "silentspeak.bridge")
    private var listener: NWListener?
    private var clients: [ObjectIdentifier: NWConnection] = [:]
    private(set) var lastStatus: Data?
    var onCommand: (([String: Any], NWConnection) -> Void)?

    init(options: Options) {
        self.options = options
    }

    func start() throws {
        let options = self.options
        let ws = NWProtocolWebSocket.Options()
        ws.autoReplyPing = true
        ws.setClientRequestHandler(queue) { _, headers in
            var origin: String?
            for header in headers where header.name.lowercased() == "origin" {
                origin = header.value
            }
            if Server.allows(origin: origin, options: options) {
                return NWProtocolWebSocket.Response(status: .accept, subprotocol: nil)
            }
            log("rejected connection from origin \(origin ?? "?") (add it with --origin)")
            return NWProtocolWebSocket.Response(status: .reject, subprotocol: nil)
        }
        let params = NWParameters.tcp
        params.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)
        params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: options.port)!)
        params.allowLocalEndpointReuse = true

        let listener = try NWListener(using: params)
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready: log("listening on ws://127.0.0.1:\(options.port)")
            case .failed(let error):
                log("listener failed: \(error)")
                exit(1)
            default: break
            }
        }
        listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
        listener.start(queue: queue)
        self.listener = listener
    }

    static func allows(origin: String?, options: Options) -> Bool {
        guard let origin = origin?.lowercased() else { return true }
        if origin.hasPrefix("http://localhost:") || origin == "http://localhost"
            || origin.hasPrefix("http://127.0.0.1:") || origin == "http://127.0.0.1" {
            return true
        }
        return options.origins.contains(origin)
    }

    private func accept(_ connection: NWConnection) {
        let id = ObjectIdentifier(connection)
        connection.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                self.clients[id] = connection
                log("client connected (\(self.clients.count) total)")
                self.send(Wire.encode(["type": "hello", "version": 1, "simulated": self.options.simulate,
                                       "typing": self.options.typing, "accessibility": AXIsProcessTrusted()]),
                          to: connection)
                if let status = self.lastStatus { self.send(status, to: connection) }
                self.receive(on: connection)
            case .failed, .cancelled:
                self.clients[id] = nil
                log("client disconnected (\(self.clients.count) total)")
            default: break
            }
        }
        connection.start(queue: queue)
    }

    private func receive(on connection: NWConnection) {
        connection.receiveMessage { [weak self] data, context, _, error in
            guard let self else { return }
            if let data,
               let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                DispatchQueue.main.async { self.onCommand?(object, connection) }
            }
            if error == nil, context?.isFinal != true {
                self.receive(on: connection)
            } else {
                connection.cancel()
            }
        }
    }

    func send(_ data: Data?, to connection: NWConnection) {
        guard let data else { return }
        let metadata = NWProtocolWebSocket.Metadata(opcode: .text)
        let context = NWConnection.ContentContext(identifier: "text", metadata: [metadata])
        connection.send(content: data, contentContext: context, isComplete: true, completion: .contentProcessed { _ in })
    }

    func broadcast(_ data: Data?) {
        guard let data else { return }
        queue.async {
            for connection in self.clients.values { self.send(data, to: connection) }
        }
    }

    func broadcastStatus(_ data: Data?) {
        lastStatus = data
        broadcast(data)
    }
}

// MARK: - Motion sources

protocol MotionSource {
    func start(onSample: @escaping (MotionSample) -> Void, onStatus: @escaping (String, String?) -> Void)
}

final class HeadphoneSource: NSObject, MotionSource, CMHeadphoneMotionManagerDelegate {
    private let manager = CMHeadphoneMotionManager()
    private var onStatus: ((String, String?) -> Void)?

    func start(onSample: @escaping (MotionSample) -> Void, onStatus: @escaping (String, String?) -> Void) {
        self.onStatus = onStatus
        guard manager.isDeviceMotionAvailable else {
            onStatus("unsupported", "Headphone motion is not available on this Mac.")
            return
        }
        if [.denied, .restricted].contains(CMHeadphoneMotionManager.authorizationStatus()) {
            onStatus("denied", "Motion access denied. Allow it for your terminal app in System Settings › Privacy & Security › Motion & Fitness.")
            return
        }
        manager.delegate = self
        manager.startConnectionStatusUpdates()
        onStatus("waiting", "Waiting for AirPods. Make sure they are the Mac's active audio output.")
        manager.startDeviceMotionUpdates(to: .main) { [weak self] motion, error in
            if let error {
                let ns = error as NSError
                if ns.domain == CMErrorDomain, ns.code == Int(CMErrorMotionActivityNotAuthorized.rawValue) {
                    self?.onStatus?("denied", "Motion access denied for this process.")
                } else {
                    self?.onStatus?("error", error.localizedDescription)
                }
                return
            }
            guard let motion else { return }
            onSample(MotionSample(motion))
        }
    }

    func headphoneMotionManagerDidConnect(_ manager: CMHeadphoneMotionManager) {
        onStatus?("streaming", nil)
    }

    func headphoneMotionManagerDidDisconnect(_ manager: CMHeadphoneMotionManager) {
        onStatus?("waiting", "AirPods disconnected.")
    }
}

/// Fake AirPods for developing the web app without hardware: resting noise with a
/// short "word" burst every couple of seconds, plus a burst whenever Right ⌥ is held.
final class SimulatedSource: MotionSource {
    private var timer: Timer?
    private var t: TimeInterval = 0
    private var burstEnd: TimeInterval = -1
    private var burstFrequency = 2.0
    private var burstAxis = 0
    var heldKey = false

    func start(onSample: @escaping (MotionSample) -> Void, onStatus: @escaping (String, String?) -> Void) {
        onStatus("streaming", "Simulated motion (no AirPods).")
        timer = Timer.scheduledTimer(withTimeInterval: 0.04, repeats: true) { [self] _ in
            t += 0.04
            let cycle = t.truncatingRemainder(dividingBy: 2.5)
            if (cycle < 0.04 || heldKey) && t > burstEnd {
                burstEnd = t + 0.6
                burstFrequency = Double(Int.random(in: 1...3))
                burstAxis = Int.random(in: 0...2)
            }
            var rotation = (Double.random(in: -0.02...0.02), Double.random(in: -0.02...0.02), Double.random(in: -0.02...0.02))
            if t < burstEnd {
                let phase = 1 - (burstEnd - t) / 0.6
                let v = 0.25 * sin(.pi * phase) * sin(2 * .pi * burstFrequency * phase)
                switch burstAxis {
                case 0: rotation.0 += v
                case 1: rotation.1 += v
                default: rotation.2 += v
                }
            }
            let accel = (rotation.0 * 0.05, rotation.1 * 0.05, rotation.2 * 0.05)
            onSample(MotionSample(t: ProcessInfo.processInfo.systemUptime, accel: accel, rotation: rotation))
        }
    }
}

// MARK: - Typing into the front app

enum Typist {
    static func type(_ text: String) -> Bool {
        guard AXIsProcessTrusted() else { return false }
        let source = CGEventSource(stateID: .combinedSessionState)
        let units = Array(text.utf16)
        for start in stride(from: 0, to: units.count, by: 20) {
            var chunk = Array(units[start..<min(start + 20, units.count)])
            for keyDown in [true, false] {
                guard let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: keyDown) else { continue }
                event.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: &chunk)
                event.post(tap: .cghidEventTap)
            }
        }
        return true
    }
}

// MARK: - Main

let options = parse(Array(CommandLine.arguments.dropFirst()))
let server = Server(options: options)
let simulated = options.simulate ? SimulatedSource() : nil
let source: MotionSource = simulated ?? HeadphoneSource()

// A (hidden) AppKit app gives us the main run loop CoreMotion wants and the
// global key monitor for Right ⌥.
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

server.onCommand = { object, connection in
    switch object["type"] as? String {
    case "type":
        // Bounded so an allowed page can't flood the front app with key events.
        let text = object["text"] as? String ?? ""
        let ok = options.typing && !text.isEmpty && text.count <= 500 && Typist.type(text)
        server.send(Wire.encode(["type": "typed", "ok": ok, "accessibility": AXIsProcessTrusted()]), to: connection)
        if !ok, !AXIsProcessTrusted() {
            log("typing needs Accessibility access for your terminal app (System Settings › Privacy & Security › Accessibility)")
        }
    case "ping":
        server.send(Wire.encode(["type": "pong"]), to: connection)
    case "requestAccessibility":
        let prompt = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(prompt)
    default:
        break
    }
}

do {
    try server.start()
} catch {
    log("could not start listener: \(error)")
    exit(1)
}

source.start(onSample: { sample in
    server.broadcast(Wire.motion(sample))
}, onStatus: { state, message in
    log("motion: \(state)\(message.map { " – \($0)" } ?? "")")
    server.broadcastStatus(Wire.status(state, message: message))
})

// Right ⌥ (keyCode 61) relayed as a capture key. Global delivery needs Accessibility access.
let hotkeyCode: UInt16 = 61
NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged) { event in
    guard event.keyCode == hotkeyCode else { return }
    let down = event.modifierFlags.contains(.option)
    simulated?.heldKey = down
    server.broadcast(Wire.encode(["type": "key", "key": "rightOption", "down": down]))
}

log("silentspeak-bridge ready\(options.simulate ? " (simulated motion)" : "")")
if !AXIsProcessTrusted() {
    log("note: Accessibility access is off for this terminal; typing and the global Right ⌥ key will not work until it is granted")
}
app.run()
