import Foundation
import Testing
@testable import SilentSpeakCore

@Suite struct DatasetTests {
    private func sample(_ t: Double) -> MotionSample { MotionSample(t: t, rotation: (0.1, 0, 0)) }

    @Test func testDecodesLegacyFileWithoutExpansions() throws {
        // The Subvox-era format had only vocabulary + templates.
        let json = """
        {"vocabulary":["yes","no"],"templates":[]}
        """
        let dataset = try JSONDecoder().decode(Dataset.self, from: Data(json.utf8))
        #expect(dataset.vocabulary == ["yes", "no"])
        #expect(dataset.expansions == [:])
        #expect(dataset.output(for: "yes") == "yes")
    }

    @Test func testOutputUsesExpansionWhenSet() {
        var dataset = Dataset.starter
        dataset.expansions["brb"] = "be right back"
        dataset.expansions["yes"] = "   "
        #expect(dataset.output(for: "brb") == "be right back")
        #expect(dataset.output(for: "yes") == "yes", "blank expansions fall back to the word")
    }

    @Test func testRoundTripThroughFile() throws {
        let url = FileManager.default.temporaryDirectory.appending(path: "silentspeak-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: url) }
        var dataset = Dataset.starter
        dataset.templates.append(Template(label: "yes", samples: [sample(0), sample(0.04), sample(0.08)]))
        dataset.expansions["yes"] = "yes please"
        try TemplateStore.save(dataset, to: url)
        let loaded = try TemplateStore.load(from: url)
        #expect(loaded == dataset)
    }

    @Test func testMergeSkipsDuplicateTakesAndAddsWords() {
        let shared = Template(label: "yes", samples: [sample(0), sample(0.04)])
        var a = Dataset(vocabulary: ["yes"], templates: [shared], expansions: ["yes": "yeah"])
        let b = Dataset(vocabulary: ["yes", "stop"],
                        templates: [shared, Template(label: "stop", samples: [sample(0), sample(0.04)])],
                        expansions: ["yes": "yep"])
        a.merge(b)
        #expect(a.vocabulary == ["yes", "stop"])
        #expect(a.templates.count == 2)
        #expect(a.expansions["yes"] == "yep")
        #expect(a.takeCounts == ["yes": 1, "stop": 1])
    }
}
