# SilentSpeak

Mouth a word without making a sound. Your AirPods Pro feel your jaw move. SilentSpeak turns that motion into text, speaks it back, or types it into whatever app you're using.

It's built on the idea behind [subvox](https://github.com/joeblau/subvox) by Joe Blau: AirPods head-motion data (`CMHeadphoneMotionManager`) carries enough information to tell a handful of silently mouthed words apart. SilentSpeak keeps that experiment honest (the statistics are still there) and makes it usable as an input method.

No language model, no cloud inference. A small-vocabulary template recognizer that you train yourself in a minute.

Two ways to run it:

| | Web app + bridge (recommended) | Native macOS app |
|---|---|---|
| UI | `web/`, React + Vite, deploys to Vercel | `SilentSpeak/`, SwiftUI, needs Xcode |
| Motion | `silentspeak-bridge`, a tiny native helper streaming AirPods motion over a loopback WebSocket | read directly |
| Engine | TypeScript port in `web/src/engine` | `SilentSpeakCore` Swift package |
| Output | speech (Web Speech API), typing and global hotkey via the bridge | speech, typing, global hotkey |
| Data | browser storage + JSON export | `~/Library/Application Support/SilentSpeak/dataset.json` |

Dataset files are interchangeable between the two.

## Web app + bridge

Browsers can't read AirPods motion, so one small native piece stays on your Mac: the bridge. It binds only to `127.0.0.1`, streams motion samples as JSON, relays the Right ⌥ key, and types text into the front app when the web app asks. Everything else (training, DTW matching, evaluation, speech, storage) runs in the browser.

```sh
# 1. The bridge (needs only Xcode Command Line Tools)
swift run silentspeak-bridge            # add --simulate to try it without AirPods

# 2. The web app
cd web && npm install && npm run dev    # http://localhost:5173
```

The page connects to `ws://127.0.0.1:8765` on its own. Grant **Motion** access to your terminal app when macOS asks; for typing into other apps and the global Right ⌥ key, also grant it **Accessibility** access (System Settings › Privacy & Security), then restart the bridge.

### Deploying to Vercel

Import this repo in Vercel; `vercel.json` already points the build at `web/`. Then run the bridge with your deployment's origin allowed:

```sh
swift run silentspeak-bridge --origin https://your-app.vercel.app
```

The bridge admits `localhost` dev servers automatically and rejects every other origin, so a random website can't read your motion or type on your Mac. Chrome and Firefox allow a page on HTTPS to open a WebSocket to `127.0.0.1`; Safari may not, so use Chrome for the hosted app.

### Bridge options

```
silentspeak-bridge [--port 8765] [--origin URL]... [--simulate] [--no-type]
```

`--simulate` fakes AirPods: resting noise with a short burst every couple of seconds (and whenever Right ⌥ is held). `--no-type` refuses typing requests entirely.

## Native macOS app

```sh
brew install xcodegen   # once
xcodegen generate
open SilentSpeak.xcodeproj   # ⌘R
```

Set `DEVELOPMENT_TEAM` in `project.yml` (or pick a team in Xcode's Signing settings). Requires macOS 14+ and AirPods Pro (or other headphones with head tracking) connected as the Mac's audio output. The native app additionally records experiment sessions (motion CSV, audio, labelled events) to `~/Documents/SilentSpeak/Sessions/` and shows a live microphone transcript for comparison.

The engine and its tests don't need Xcode:

```sh
swift test
swift run silentspeak-eval                  # evaluates the native app's dataset
swift run silentspeak-eval my.json --ablate # compares every feature-set combination
cd web && npm test                          # the TypeScript engine's tests
```

## Using it

1. **Train.** Pick a word, hold **Space**, mouth it silently, release. Aim for 8 to 10 takes per word. Optionally set what the word *outputs as* (a phrase, a sentence, an emoji).
2. **Evaluate.** Press **Evaluate**. Leave-one-out accuracy is compared with the same procedure on shuffled labels, 500 times. If p < 0.05, your motion stream really does distinguish those words. Toggle acceleration / rotation / attitude and k to see what carries the signal.
3. **Decode.** Hold Space and mouth a word. Turn on **Speak decoded words** to hear it, or **Type into front app**, enable **Right ⌥ push-to-mouth**, switch to any app, hold Right Option and mouth away.

In the web app, `window.silentspeak` is the live model if you want to poke at it from the console.

## How decoding works

1. **Segmentation** (`capture.ts` / `CaptureController`). Space or Right ⌥ held, or an energy trigger above a calibrated noise floor with pre-roll and hangover.
2. **Features** (`motion.ts` / `MotionFeatures`). Per frame: user acceleration (3), rotation rate (3), attitude change since the start of the segment (3). Each channel is mean-centred and quiet lead-in / lead-out frames are trimmed.
3. **Matching** (`dtw.ts`, `classifier.ts` / `TemplateClassifier`). Channels are z-scaled across the training set. The segment is DTW-matched (Sakoe–Chiba band) against every take. The k nearest takes vote, each weighted by 1/distance, with every word's closest take always in the pool so the runner-up is real. A segment is rejected if the best distance exceeds *max distance* or the vote margin is below *min confidence*.
4. **Is it real?** (`evaluation.ts` / `Evaluation`). Leave-one-out accuracy under the same k-NN rule, against a 500× label-permutation null. The web app runs this in a Web Worker.

## Files

| Path | What |
|---|---|
| `web/src/engine` | TypeScript engine: motion features, DTW, k-NN classifier, evaluation, dataset model, capture controller |
| `web/src` | Bridge client, app model, React views |
| `Sources/silentspeak-bridge` | The native motion bridge |
| `Sources/SilentSpeakCore` | Swift engine (same algorithms) used by the native app and CLI |
| `Sources/silentspeak-eval` | Command-line evaluator |
| `SilentSpeak/` | Native macOS app |
| `Tests/`, `web/src/engine/__tests__` | Swift Testing and Vitest suites |

## Known limits

- Headphone motion is processed and low-rate (roughly 25 Hz on AirPods). Expect jaw and head movement, not vocal vibration.
- Templates are user- and session-specific. Re-seating the AirPods can shift the signal. Export a dataset before you lose a good one.
- The bridge is a command-line tool, so macOS attributes its Motion and Accessibility permissions to the terminal app that runs it.
- The default thresholds are starting points. If noise gets accepted, lower *max distance* or raise *min confidence*.

## License

MIT. Based on subvox, © Joe Blau, also MIT. See `LICENSE`.
