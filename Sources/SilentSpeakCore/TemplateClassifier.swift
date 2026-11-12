import Foundation

public struct Template: Codable, Identifiable, Hashable, Sendable {
    public var id: UUID
    public var label: String
    public var samples: [MotionSample]
    public var createdAt: Date

    public init(id: UUID = UUID(), label: String, samples: [MotionSample], createdAt: Date = Date()) {
        self.id = id
        self.label = label
        self.samples = samples
        self.createdAt = createdAt
    }

    public var duration: TimeInterval {
        guard let first = samples.first, let last = samples.last else { return 0 }
        return last.t - first.t
    }
}

public struct RankedLabel: Identifiable, Hashable, Sendable {
    public var label: String
    /// DTW distance to this word's closest take.
    public var distance: Double
    /// Share of the distance-weighted neighbour vote this word received (0…1; all shares sum to 1).
    public var score: Double
    public var id: String { label }

    public init(label: String, distance: Double, score: Double) {
        self.label = label
        self.distance = distance
        self.score = score
    }
}

public struct Prediction: Hashable, Sendable {
    public var ranked: [RankedLabel]
    /// 0…1 margin between the best and runner-up vote share.
    public var confidence: Double
    public var accepted: Bool

    public var best: RankedLabel? { ranked.first }
}

/// A labelled distance from a query to one stored take.
public struct Neighbour: Sendable {
    public var label: String
    public var distance: Double
    public init(label: String, distance: Double) {
        self.label = label
        self.distance = distance
    }
}

/// Small-vocabulary recognizer: distance-weighted k-nearest-neighbour DTW against
/// user-recorded templates. One mis-recorded take can no longer hijack a prediction
/// the way it does with plain 1-NN, and the vote share gives a calibrated-ish confidence.
public struct TemplateClassifier: Sendable {
    public let featureSet: FeatureSet
    private let entries: [(label: String, frames: [[Double]])]
    private let scales: [Double]

    public var labels: [String] { Array(Set(entries.map(\.label))).sorted() }
    public var templateCount: Int { entries.count }

    public init?(templates: [Template], featureSet: FeatureSet) {
        guard !featureSet.isEmpty else { return nil }
        let raw = templates.map { MotionFeatures.frames(MotionFeatures.trim($0.samples), set: featureSet) }
        guard Set(templates.map(\.label)).count >= 2 else { return nil }
        let scales = MotionFeatures.channelScales(raw)
        self.featureSet = featureSet
        self.scales = scales
        self.entries = zip(templates, raw).map { ($0.label, MotionFeatures.scaled($1, by: scales)) }
    }

    /// Distance from `samples` to every stored take.
    public func neighbours(_ samples: [MotionSample]) -> [Neighbour] {
        let query = MotionFeatures.scaled(
            MotionFeatures.frames(MotionFeatures.trim(samples), set: featureSet), by: scales)
        return entries.map { Neighbour(label: $0.label, distance: DTW.distance(query, $0.frames)) }
    }

    public func rank(_ samples: [MotionSample], k: Int = 3) -> [RankedLabel] {
        Self.vote(neighbours(samples), k: k)
    }

    public func predict(_ samples: [MotionSample], k: Int = 3, maxDistance: Double, minConfidence: Double) -> Prediction {
        let ranked = rank(samples, k: k)
        let confidence = Self.margin(ranked)
        let accepted = (ranked.first?.distance ?? .infinity) <= maxDistance && confidence >= minConfidence
        return Prediction(ranked: ranked, confidence: confidence, accepted: accepted)
    }

    /// Distance-weighted vote over the `k` globally nearest takes, always including each
    /// word's own closest take so the runner-up is never missing from the comparison.
    /// Weight is 1/distance, so a take twice as close counts twice as much.
    public static func vote(_ neighbours: [Neighbour], k: Int) -> [RankedLabel] {
        guard !neighbours.isEmpty else { return [] }
        let finite = neighbours.filter { $0.distance.isFinite }
        guard !finite.isEmpty else {
            let labels = Set(neighbours.map(\.label)).sorted()
            return labels.map { RankedLabel(label: $0, distance: .infinity, score: 1 / Double(labels.count)) }
        }
        let sorted = finite.sorted { $0.distance < $1.distance }

        var closest: [String: Double] = [:]
        for n in sorted where closest[n.label] == nil { closest[n.label] = n.distance }

        var pool = Array(sorted.prefix(max(k, 1)))
        for (label, distance) in closest where !pool.contains(where: { $0.label == label }) {
            pool.append(Neighbour(label: label, distance: distance))
        }

        var weights: [String: Double] = [:]
        for n in pool { weights[n.label, default: 0] += 1 / max(n.distance, 1e-6) }
        let total = weights.values.reduce(0, +)

        return closest.map { label, distance in
            RankedLabel(label: label, distance: distance, score: (weights[label] ?? 0) / total)
        }
        .sorted { a, b in
            if a.score != b.score { return a.score > b.score }
            return a.distance < b.distance
        }
    }

    /// Margin between the top two vote shares. With one word only there is nothing to beat, so 0.
    public static func margin(_ ranked: [RankedLabel]) -> Double {
        guard ranked.count >= 2 else { return 0 }
        return max(0, min(1, ranked[0].score - ranked[1].score))
    }
}

/// Leave-one-out accuracy plus a label-permutation test: the honest answer to
/// "is the motion stream statistically distinguishable between words?"
public struct Evaluation: Sendable {
    public var labels: [String]
    /// confusion[actual][predicted]
    public var confusion: [[Int]]
    public var accuracy: Double
    /// Accuracy of always guessing the most common label.
    public var chance: Double
    public var permutationMean: Double
    public var permutationP95: Double
    public var pValue: Double
    public var permutations: Int
    public var templateCount: Int
    public var k: Int
    public var featureSet: FeatureSet

    /// Per-word recall (diagonal of the confusion matrix over the row total).
    public var recall: [Double] {
        confusion.map { row in
            let total = row.reduce(0, +)
            return total == 0 ? 0 : Double(row[confusion.firstIndex(where: { $0 == row })!]) / Double(total)
        }
    }

    public static func run(templates: [Template], featureSet: FeatureSet, k: Int = 3, permutations: Int = 500) -> Evaluation? {
        let labels = Array(Set(templates.map(\.label))).sorted()
        let counts = Dictionary(grouping: templates, by: \.label).mapValues(\.count)
        guard labels.count >= 2, counts.values.allSatisfy({ $0 >= 2 }), !featureSet.isEmpty else { return nil }

        let raw = templates.map { MotionFeatures.frames(MotionFeatures.trim($0.samples), set: featureSet) }
        let scales = MotionFeatures.channelScales(raw)
        let seqs = raw.map { MotionFeatures.scaled($0, by: scales) }
        let n = seqs.count

        // Pairwise distances once; every labelling (true or permuted) reuses them.
        var distance = [[Double]](repeating: [Double](repeating: 0, count: n), count: n)
        for i in 0..<n {
            for j in (i + 1)..<max(i + 1, n) {
                let d = DTW.distance(seqs[i], seqs[j])
                distance[i][j] = d
                distance[j][i] = d
            }
        }

        let index = Dictionary(uniqueKeysWithValues: labels.enumerated().map { ($1, $0) })
        let truth = templates.map { index[$0.label]! }

        func leaveOneOut(_ assignment: [Int]) -> [Int] {
            (0..<n).map { i in
                let neighbours = (0..<n).compactMap { j -> Neighbour? in
                    j == i ? nil : Neighbour(label: labels[assignment[j]], distance: distance[i][j])
                }
                return index[TemplateClassifier.vote(neighbours, k: k).first!.label]!
            }
        }

        func accuracy(_ predicted: [Int], _ actual: [Int]) -> Double {
            Double(zip(predicted, actual).filter { $0 == $1 }.count) / Double(n)
        }

        let predicted = leaveOneOut(truth)
        var confusion = [[Int]](repeating: [Int](repeating: 0, count: labels.count), count: labels.count)
        for (p, a) in zip(predicted, truth) { confusion[a][p] += 1 }
        let observed = accuracy(predicted, truth)

        var generator = SystemRandomNumberGenerator()
        var nullAccuracies: [Double] = []
        nullAccuracies.reserveCapacity(permutations)
        for _ in 0..<permutations {
            let shuffled = truth.shuffled(using: &generator)
            nullAccuracies.append(accuracy(leaveOneOut(shuffled), shuffled))
        }
        nullAccuracies.sort()
        let atLeast = nullAccuracies.filter { $0 >= observed }.count

        return Evaluation(
            labels: labels,
            confusion: confusion,
            accuracy: observed,
            chance: Double(counts.values.max()!) / Double(n),
            permutationMean: nullAccuracies.reduce(0, +) / Double(max(permutations, 1)),
            permutationP95: nullAccuracies.isEmpty ? 0 : nullAccuracies[Int(Double(nullAccuracies.count - 1) * 0.95)],
            pValue: Double(atLeast + 1) / Double(permutations + 1),
            permutations: permutations,
            templateCount: n,
            k: k,
            featureSet: featureSet)
    }
}
