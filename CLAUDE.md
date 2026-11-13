# Tab Sound Recorder

Chrome extension (Manifest V3, plain JS, no build step, no dependencies) that records a tab's audio and saves it as WAV or WebM. See README.md for install, use and file roles.

- Flow: popup gets a tab stream id (`chrome.tabCapture.getMediaStreamId`) → service worker opens the offscreen document → offscreen records (MediaRecorder for WebM, AudioWorklet PCM for WAV) and makes a blob URL → service worker saves it with `chrome.downloads`, then closes the offscreen page.
- `DEFAULT_SETTINGS` is duplicated in `popup.js` and `service-worker.js`; keep them in sync.
- UI uses the owner's Stark design system tokens (trimmed copy in `popup.css`), system font fallback since the popup must work offline.
- Chrome 137+ ignores `--load-extension`; `work/smoke-test.mjs` loads it via the DevTools pipe (`Extensions.loadUnpacked`). `work/` is gitignored.
