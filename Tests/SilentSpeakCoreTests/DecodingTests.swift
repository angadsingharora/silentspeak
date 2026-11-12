import Foundation
import Testing
@testable import SilentSpeakCore

@Suite struct DecodingTests {
    /// A synthetic "word": a burst of rotation at `frequency` cycles over the segment.
    private func take(_ frequency: Double, axis: Int, frames: Int = 30, noise: Double = 0.01) -> [MotionSample] {
        (0..<frames).map { i in
            let t = Double(i) / 25
            let envelope = sin(Double.pi * Double(i) / Double(frames - 1))
            let v = 0.2 * envelope * sin(2 * .pi * frequency * Double(i) / Double(frames))
            let jitter = { Double.random(in: -noise...noise) }
            var rotation = (jitter(), jitter(), jitter())
            switch axis {
            case 0: rotation.0 += v
            case 1: rotation.1 += v
            default: rotation.2 += v
            }
            return MotionSample(t: t, rotation: rotation)
        }
    }

    @Test func testDTWIdenticalIsZeroAndWarpTolerant() {
        let a = MotionFeatures.frames(take(2, axis: 0, noise: 0), set: .rotation)
        let stretched = MotionFeatures.frames(take(2, axis: 0, frames: 40, noise: 0), set: .rotation)
        let other = MotionFeatures.frames(take(2, axis: 1, noise: 0), set: .rotation)
        #expect(DTW.distance(a, a) == 0)
        #expect(DTW.distance(a, stretched) < DTW.distance(a, other))
    }

    @Test func testClassifierSeparatesDistinctWords() throws {
        var templates: [Template] = []
        for _ in 0..<6 {
            templates.append(Template(label: "yes", samples: take(2, axis: 0)))
            templates.append(Template(label: "no", samples: take(3, axis: 1)))
        }
        let classifier = try #require(TemplateClassifier(templates: templates, featureSet: .all))
        let prediction = classifier.predict(take(3, axis: 1), maxDistance: 10, minConfidence: 0)
        #expect(prediction.best?.label == "no")
        #expect(prediction.accepted)
        #expect(abs(prediction.ranked.map(\.score).reduce(0, +) - 1) <= 1e-9)
        #expect(prediction.confidence > 0.3)
    }

    @Test func testVoteOutweighsOneCloseOutlier() {
        // One stray "no" take sits closest, but three "yes" takes are nearly as close.
        let neighbours = [
            Neighbour(label: "no", distance: 0.50),
            Neighbour(label: "yes", distance: 0.55),
            Neighbour(label: "yes", distance: 0.60),
            Neighbour(label: "yes", distance: 0.62),
            Neighbour(label: "no", distance: 1.80),
            Neighbour(label: "maybe", distance: 2.5),
        ]
        #expect(TemplateClassifier.vote(neighbours, k: 1).first?.label == "no")
        let k3 = TemplateClassifier.vote(neighbours, k: 3)
        #expect(k3.first?.label == "yes")
        // Every word is still ranked, even those outside the k nearest.
        #expect(Set(k3.map(\.label)) == ["yes", "no", "maybe"])
        #expect(k3.first { $0.label == "no" }?.distance == 0.50)
        #expect(abs(k3.map(\.score).reduce(0, +) - 1) <= 1e-9)
    }

    @Test func testVoteHandlesInfiniteDistances() {
        let ranked = TemplateClassifier.vote([Neighbour(label: "a", distance: .infinity),
                                              Neighbour(label: "b", distance: .infinity)], k: 3)
        #expect(ranked.count == 2)
        #expect(TemplateClassifier.margin(ranked) == 0)
    }

    @Test func testMarginNeedsTwoWords() {
        #expect(TemplateClassifier.margin([RankedLabel(label: "a", distance: 0.1, score: 1)]) == 0)
    }

    @Test func testEvaluationBeatsChanceOnlyWhenSignalExists() throws {
        var real: [Template] = []
        var noise: [Template] = []
        for _ in 0..<8 {
            real.append(Template(label: "yes", samples: take(2, axis: 0)))
            real.append(Template(label: "no", samples: take(3, axis: 2)))
            noise.append(Template(label: "yes", samples: take(0, axis: 0, noise: 0.05)))
            noise.append(Template(label: "no", samples: take(0, axis: 0, noise: 0.05)))
        }
        let signal = try #require(Evaluation.run(templates: real, featureSet: .all, permutations: 200))
        #expect(signal.accuracy > 0.9)
        #expect(signal.pValue < 0.01)
        #expect(signal.recall.count == 2)

        let null = try #require(Evaluation.run(templates: noise, featureSet: .all, permutations: 200))
        #expect(null.pValue > 0.01)
    }

    @Test func testTrimDropsQuietPadding() {
        let quiet = (0..<20).map { MotionSample(t: Double($0) / 25) }
        let burst = take(2, axis: 0, noise: 0).map { s -> MotionSample in
            var s = s; s.t += 0.8; return s
        }
        let trimmed = MotionFeatures.trim(quiet + burst + quiet.map { var s = $0; s.t += 2; return s })
        #expect(trimmed.count < 40)
        #expect(trimmed.count >= 20)
    }

    @Test func testFeatureSetNames() {
        #expect(FeatureSet(names: "accel,rotation") == [.acceleration, .rotation])
        #expect(FeatureSet(names: "all") == .all)
        #expect(FeatureSet(names: "bogus") == nil)
        #expect(FeatureSet.all.names == ["acceleration", "rotation", "attitude"])
    }
}
