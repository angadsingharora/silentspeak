import Foundation
import SilentSpeakCore

// silentspeak-eval: evaluate a SilentSpeak dataset from the terminal.
//
//   silentspeak-eval [dataset.json] [--features accel,rotation,attitude] [--k 3]
//                    [--permutations 500] [--ablate]
//
// With no path, the app's own dataset in Application Support is used.
// --ablate runs every feature-set combination and prints a comparison table.

struct Options {
    var path: URL = TemplateStore.url
    var featureSet: FeatureSet = .all
    var k = 3
    var permutations = 500
    var ablate = false
}

func usage() -> Never {
    FileHandle.standardError.write(Data("""
    usage: silentspeak-eval [dataset.json] [--features accel,rotation,attitude] [--k N] [--permutations N] [--ablate]

    """.utf8))
    exit(2)
}

func parse(_ args: [String]) -> Options {
    var options = Options()
    var iterator = args.makeIterator()
    while let arg = iterator.next() {
        switch arg {
        case "--features", "-f":
            guard let value = iterator.next(), let set = FeatureSet(names: value) else { usage() }
            options.featureSet = set
        case "--k", "-k":
            guard let value = iterator.next(), let k = Int(value), k >= 1 else { usage() }
            options.k = k
        case "--permutations", "-p":
            guard let value = iterator.next(), let p = Int(value), p >= 0 else { usage() }
            options.permutations = p
        case "--ablate":
            options.ablate = true
        case "--help", "-h":
            usage()
        default:
            if arg.hasPrefix("-") { usage() }
            options.path = URL(fileURLWithPath: arg)
        }
    }
    return options
}

func percent(_ v: Double) -> String { String(format: "%5.1f%%", v * 100) }

func printSummary(_ e: Evaluation) {
    print("features:       \(e.featureSet.names.joined(separator: "+"))   k=\(e.k)   takes=\(e.templateCount)")
    print("accuracy:       \(percent(e.accuracy))")
    print("chance:         \(percent(e.chance))")
    print("shuffled mean:  \(percent(e.permutationMean))   95th pct: \(percent(e.permutationP95))")
    print("p-value:        \(e.pValue < 0.001 ? "< 0.001" : String(format: "%.3f", e.pValue))   (\(e.permutations) permutations)")
    print(e.pValue < 0.05 ? "verdict:        signal beyond chance" : "verdict:        not distinguishable from chance yet")
    print()
    let header = "actual \\ predicted"
    let width = max(header.count, e.labels.map(\.count).max() ?? 0)
    print(header.padding(toLength: width + 2, withPad: " ", startingAt: 0)
          + e.labels.map { $0.padding(toLength: max($0.count, 5), withPad: " ", startingAt: 0) }.joined(separator: " "))
    for (row, label) in e.labels.enumerated() {
        let cells = zip(e.labels, e.confusion[row]).map { name, count in
            String(count).padding(toLength: max(name.count, 5), withPad: " ", startingAt: 0)
        }
        print(label.padding(toLength: width + 2, withPad: " ", startingAt: 0) + cells.joined(separator: " ")
              + String(format: "   recall %@", percent(e.recall[row])))
    }
}

let options = parse(Array(CommandLine.arguments.dropFirst()))

let dataset: Dataset
do {
    dataset = try TemplateStore.load(from: options.path)
} catch {
    FileHandle.standardError.write(Data("could not read \(options.path.path): \(error.localizedDescription)\n".utf8))
    exit(1)
}

print("dataset:        \(options.path.path)")
print("vocabulary:     \(dataset.vocabulary.joined(separator: ", "))")
let counts = dataset.takeCounts
print("takes:          " + dataset.vocabulary.map { "\($0)=\(counts[$0] ?? 0)" }.joined(separator: "  "))
print()

if options.ablate {
    let sets: [FeatureSet] = [
        .acceleration, .rotation, .attitude,
        [.acceleration, .rotation], [.acceleration, .attitude], [.rotation, .attitude], .all,
    ]
    print("features                        accuracy   chance   shuffled95   p")
    for set in sets {
        guard let e = Evaluation.run(templates: dataset.templates, featureSet: set, k: options.k,
                                     permutations: options.permutations) else { continue }
        let name = set.names.joined(separator: "+").padding(toLength: 32, withPad: " ", startingAt: 0)
        print(name + percent(e.accuracy) + "    " + percent(e.chance) + "   " + percent(e.permutationP95)
              + "     " + (e.pValue < 0.001 ? "<0.001" : String(format: "%.3f", e.pValue)))
    }
} else {
    guard let e = Evaluation.run(templates: dataset.templates, featureSet: options.featureSet, k: options.k,
                                 permutations: options.permutations) else {
        FileHandle.standardError.write(Data("need at least 2 words with at least 2 takes each\n".utf8))
        exit(1)
    }
    printSummary(e)
}
