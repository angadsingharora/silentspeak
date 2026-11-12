import Foundation

/// The user's vocabulary, every recorded take, and what each word should produce when decoded.
public struct Dataset: Codable, Sendable, Equatable {
    public var vocabulary: [String]
    public var templates: [Template]
    /// Optional output text per word. Mouth "brb", get "be right back".
    public var expansions: [String: String]

    public init(vocabulary: [String], templates: [Template], expansions: [String: String] = [:]) {
        self.vocabulary = vocabulary
        self.templates = templates
        self.expansions = expansions
    }

    private enum CodingKeys: String, CodingKey { case vocabulary, templates, expansions }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        vocabulary = try c.decode([String].self, forKey: .vocabulary)
        templates = try c.decode([Template].self, forKey: .templates)
        expansions = try c.decodeIfPresent([String: String].self, forKey: .expansions) ?? [:]
    }

    public static let starter = Dataset(vocabulary: ["yes", "no", "next", "back", "stop"], templates: [])

    /// What a decoded word turns into: its expansion if one is set, otherwise the word itself.
    public func output(for word: String) -> String {
        let expansion = expansions[word]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return expansion.isEmpty ? word : expansion
    }

    public func templates(for word: String) -> [Template] {
        templates.filter { $0.label == word }
    }

    public var takeCounts: [String: Int] {
        Dictionary(grouping: templates, by: \.label).mapValues(\.count)
    }

    /// Adds another dataset's words and takes. Takes already present (by id) are skipped;
    /// the other dataset's expansions win for words it defines.
    public mutating func merge(_ other: Dataset) {
        for word in other.vocabulary where !vocabulary.contains(word) { vocabulary.append(word) }
        let known = Set(templates.map(\.id))
        templates += other.templates.filter { !known.contains($0.id) }
        expansions.merge(other.expansions) { _, new in new }
    }
}

/// Persists the training set as JSON in Application Support, and reads/writes
/// arbitrary dataset files for import and export.
public enum TemplateStore {
    public static let appName = "SilentSpeak"

    public static var url: URL {
        let dir = URL.applicationSupportDirectory.appending(path: appName, directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appending(path: "dataset.json")
    }

    public static func load() -> Dataset {
        (try? load(from: url)) ?? .starter
    }

    public static func save(_ dataset: Dataset) {
        do {
            try save(dataset, to: url)
        } catch {
            print("\(appName): failed to save dataset: \(error)")
        }
    }

    public static func load(from url: URL) throws -> Dataset {
        try JSONDecoder().decode(Dataset.self, from: Data(contentsOf: url))
    }

    public static func save(_ dataset: Dataset, to url: URL) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(dataset).write(to: url, options: .atomic)
    }
}
