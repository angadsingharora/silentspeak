# SilentSpeak

Mouth a word without making a sound. Your AirPods Pro feel your jaw move. SilentSpeak turns that motion into text, speaks it back, or types it into whatever app you're using.

It's a macOS app built on the idea behind [subvox](https://github.com/joeblau/subvox) by Joe Blau: AirPods head-motion data (`CMHeadphoneMotionManager`) carries enough information to tell a handful of silently mouthed words apart. SilentSpeak keeps that experiment honest (the statistics are still there) and makes it usable as an input method.

No language model, no cloud. A small-vocabulary template recognizer that you train yourself in a minute.

## What's different from subvox

| | subvox | SilentSpeak |
|---|---|---|
| Recognizer | 1-nearest-neighbour DTW | distance-weighted **k-NN vote** (k adjustable); one bad take can't hijack a prediction |
| Output | transcript on screen | transcript, **spoken aloud**, and/or **typed into the frontmost app** |
| Phrases | words only | **expansions**: mouth "brb", get "be right back" |
| Trigger | hold Space inside the app | Space in-app, or **hold Right ⌥ from any app** |
| Dataset | app-private JSON | **import / export / merge** datasets from the File menu |
| Engine | inside the app target | `SilentSpeakCore` Swift package: `swift build` and `swift test` with just the Command Line Tools |
| CLI | none | `silentspeak-eval` evaluates a dataset from the terminal, including feature ablation |

## Build & run

```sh
brew install xcodegen   # once
xcodegen generate
open SilentSpeak.xcodeproj   # ⌘R
```

Set `DEVELOPMENT_TEAM` in `project.yml` (or pick a team in Xcode's Signing settings) so Xcode can sign the app. Requires macOS 14+ and AirPods Pro (or other headphones with head tracking) connected as the Mac's audio output. On first launch, grant **Motion**. Mic and speech prompts only appear when you start the mic.

The decoding engine and its tests don't need Xcode:

```sh
swift test
swift run silentspeak-eval                  # evaluates the app's own dataset
swift run silentspeak-eval my.json --ablate # compares every feature-set combination
```

## Using it

1. **Train.** Pick a word, hold **Space**, mouth it silently, release. Aim for 8 to 10 takes per word. Optionally set what the word *outputs as* (a phrase, a sentence, an emoji).
2. **Evaluate.** Press **Evaluate**. Leave-one-out accuracy is compared with the same procedure on shuffled labels, 500 times. If p < 0.05, your motion stream really does distinguish those words. Toggle acceleration / rotation / attitude and k to see what carries the signal.
3. **Decode.** Hold Space and mouth a word. Turn on **Speak decoded words** to hear it through the AirPods, or **Type into front app**, grant Accessibility access, enable **Right ⌥ push-to-mouth**, switch to any app, hold Right Option and mouth away.

## How decoding works

1. **Segmentation** (`CaptureController`). Space or Right ⌥ held, or an energy trigger above a calibrated noise floor with pre-roll and hangover.
2. **Features** (`MotionFeatures`). Per frame: user acceleration (3), rotation rate (3), attitude change since the start of the segment (3). Each channel is mean-centred and quiet lead-in / lead-out frames are trimmed.
3. **Matching** (`DTW`, `TemplateClassifier`). Channels are z-scaled across the training set. The segment is DTW-matched (Sakoe–Chiba band) against every take. The k nearest takes vote, each weighted by 1/distance, with every word's closest take always in the pool so the runner-up is real. A segment is rejected if the best distance exceeds *max distance* or the vote margin is below *min confidence*.
4. **Is it real?** (`Evaluation`). Leave-one-out accuracy under the same k-NN rule, against a 500× label-permutation null.

## Files

| Path | What |
|---|---|
| `Sources/SilentSpeakCore` | Motion samples, features, DTW, k-NN classifier, evaluation, dataset model and storage, capture controller |
| `Sources/silentspeak-eval` | Command-line evaluator |
| `Tests/SilentSpeakCoreTests` | Swift Testing suites for the engine |
| `SilentSpeak/` | The macOS app: motion and audio services, session recorder, output controller, SwiftUI views |

The training set lives at `~/Library/Application Support/SilentSpeak/dataset.json`. Experiment recordings (motion CSV, audio, labelled events) go to `~/Documents/SilentSpeak/Sessions/<timestamp>-<condition>/`.

## Known limits

- Headphone motion is processed and low-rate (roughly 25 Hz on AirPods). Expect jaw and head movement, not vocal vibration.
- Templates are user- and session-specific. Re-seating the AirPods can shift the signal. Export a dataset before you lose a good one.
- Typing into other apps and the global Right ⌥ key need Accessibility access (System Settings › Privacy & Security › Accessibility).
- Choosing AirPods as the mic input switches them to the Bluetooth headset (HFP) profile.

## License

MIT. Based on subvox, © Joe Blau, also MIT. See `LICENSE`.
