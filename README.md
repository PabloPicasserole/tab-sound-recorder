# Tab Sound Recorder

A small Chrome extension that records the sound playing in a browser tab (YouTube, a podcast, a web call) and saves it as an audio file. It records the tab's own audio, not your microphone.

## Install (once)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `extension` folder in this project.
4. Click the puzzle-piece icon in the toolbar and pin **Tab Sound Recorder** so the red-dot icon is always visible.

After you change any file in `extension/`, press the reload arrow on the extension's card in `chrome://extensions`.

## Use

1. Go to the tab that's playing sound.
2. Click the red-dot icon (or press **Alt+Shift+R**) and click **Start recording**. The icon shows a red **REC** badge while it records. You can close the popup and keep browsing in other tabs.
3. Click the icon again and click **Stop and save**.

Settings in the popup:

- **File type**: WAV (plays everywhere, about 10 MB per minute) or WebM (about 1.5 MB per minute, plays in Chrome and VLC).
- **Where to save**:
  - *Ask me each time* opens the normal Save dialog, so you can pick any folder and name. Chrome opens the dialog in the last folder you used.
  - *Save straight away* saves without asking into a folder inside Downloads (default `Downloads/Recordings`).

Files are named after the tab and the time, e.g. `Some video - YouTube 2026-11-12 14.03.22.wav`.

## Good to know

- It records one tab: the one you started it on. Sounds from other tabs or other apps aren't included.
- You still hear the tab while it records.
- Closing the recorded tab stops the recording and saves what was captured.
- Chrome blocks recording on its own pages (`chrome://…`, the Web Store).
- If Chrome's "Ask where to save each file" setting is on, you'll get a Save dialog even in *Save straight away* mode.

## How it works

| File | Job |
| --- | --- |
| `extension/popup.*` | The window you click: start/stop, timer, settings. |
| `extension/service-worker.js` | Coordinator: starts/stops the recorder, shows the REC badge, hands the file to Chrome's downloads. |
| `extension/offscreen.*` | Hidden page that captures the tab's audio, plays it back to you, and writes the file. |
| `extension/pcm-worklet.js` | Collects raw samples for WAV files. |

No servers, no accounts, no external libraries. Everything stays on your computer.

## Testing

`work/smoke-test.mjs` (gitignored) loads the extension into a throwaway Chrome profile, screenshots the popup, and records a test tone to WAV and WebM. Run it with `node work/smoke-test.mjs`. It can't press the real toolbar button, so the actual tab capture is only tested by hand.
