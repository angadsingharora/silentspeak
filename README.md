# silentspeak

Silent speech input from AirPods Pro. You mouth a word without voicing it, the AirPods' motion sensors pick up the jaw and head movement, and a small template matcher turns it into text. It can then speak the word out loud or type it into whatever app is in front.

This started as Joe Blau's [subvox](https://github.com/joeblau/subvox), which showed the signal is actually there. This is my version of it.

Live at https://silentspeak-theta.vercel.app

## How it's put together

Browsers can't read AirPods motion, so there are two parts.

`silentspeak-bridge` is a small Swift command-line tool that runs on your Mac. It reads headphone motion through CoreMotion and serves it over a WebSocket on 127.0.0.1:8765. It also relays the Right Option key and, if you let it, types text into the front app.

The web app in `web/` does everything else: recording takes, matching, evaluation, speech, storage. It's React + Vite + TypeScript and deploys to Vercel.

There's also a native macOS app in `SilentSpeak/` that doesn't need the bridge, sharing the Swift engine in `Sources/SilentSpeakCore`. It needs Xcode to build.

## Running it

Bridge (needs the Xcode Command Line Tools, nothing else):

    swift run silentspeak-bridge --origin https://silentspeak-theta.vercel.app

then open the site in Chrome. Or run the web app locally:

    cd web && npm install && npm run dev

and the bridge without `--origin` (localhost is always allowed). Add `--simulate` to try it without AirPods.

macOS will ask to give your terminal access to Motion. Typing into other apps and the Right Option key also need Accessibility access for the terminal, then restart the bridge.

The bridge only binds loopback and only accepts pages from localhost or origins you pass with `--origin`, so some random site can't read your motion or type on your Mac. Chrome and Firefox allow an HTTPS page to open a WebSocket to 127.0.0.1. Safari doesn't.

## Using it

Train: pick a word, hold Space, mouth it, let go. 8–10 takes per word. You can give a word a longer output, so mouthing "brb" types "be right back".

Evaluate: runs leave-one-out classification and compares it to 500 runs with shuffled labels. If p is under 0.05 your words are distinguishable. The feature checkboxes let you see which channels carry the signal; for me it's mostly rotation.

Decode: hold Space (or Right Option from any app) and mouth a word. Turn on speak or type.

`window.silentspeak` is the live model in the web app if you want to poke at it.

## How decoding works

A segment is the motion while the key is held (or, in auto mode, while energy is above a calibrated noise floor). Per frame it becomes a 9-dim vector: user acceleration, rotation rate, and attitude change since the segment started, each mean-centred, with quiet frames trimmed off both ends. Channels are z-scaled over the training set.

Matching is DTW with a Sakoe–Chiba band against every recorded take. The k nearest takes vote, weighted by 1/distance, with each word's closest take always included so the runner-up margin means something. A segment is rejected if the best distance is too large or the vote margin too small.

The evaluation runs the same thing leave-one-out and then with permuted labels to get a p-value. In the web app that's in a Web Worker.

## Other bits

- `swift run silentspeak-eval dataset.json --ablate` evaluates a dataset from the terminal and compares feature sets.
- `swift test` and `cd web && npm test` run the two engines' tests.
- Dataset JSON is the same between the web and native apps, so you can export from one and import into the other.
- Motion is ~25 Hz and already filtered on the AirPods. You're seeing jaw and head movement, not anything acoustic. Templates drift if you re-seat the AirPods.

## License

MIT. subvox is © Joe Blau, also MIT.
