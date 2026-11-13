// Hidden page that does the actual recording. It captures the tab's audio stream, keeps it
// audible (capturing a tab mutes it otherwise), and writes either WAV or WebM.

let session = null; // { stream, ctx, format, ... }

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'start') {
    start(msg.streamId, msg.format).then(() => reply({ ok: true }), (e) => reply({ ok: false, error: friendly(e) }));
    return true;
  }
  if (msg.type === 'stop') {
    stop();
    reply({ ok: true });
  }
});

function friendly(e) {
  if (e?.name === 'NotAllowedError') return 'Chrome did not allow recording this tab. Click the extension icon on the tab and try again.';
  return e?.message || String(e);
}

async function start(streamId, format) {
  if (session) throw new Error('Already recording.');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false
  });

  // Play the captured sound back so you can still hear the tab.
  const ctx = new AudioContext();
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  const source = ctx.createMediaStreamSource(stream);
  source.connect(ctx.destination);

  session = { stream, ctx, source, format, startedAt: Date.now() };

  // If the tab goes away (closed, crashed), stop and save what we have.
  stream.getAudioTracks()[0].addEventListener('ended', () => {
    chrome.runtime.sendMessage({ target: 'background', type: 'ended' });
  });

  if (format === 'webm') startWebm(stream);
  else await startWav(ctx, source);
}

function startWebm(stream) {
  const mimeType = 'audio/webm;codecs=opus';
  const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 192000 });
  const parts = [];
  recorder.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  recorder.onstop = () => finish(new Blob(parts, { type: 'audio/webm' }), 'webm');
  recorder.start(1000);
  session.recorder = recorder;
}

async function startWav(ctx, source) {
  await ctx.audioWorklet.addModule('pcm-worklet.js');
  const node = new AudioWorkletNode(ctx, 'pcm-capture', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 2,
    channelCountMode: 'explicit'
  });
  // Samples are packed into 16-bit stereo and folded into Blobs every few seconds,
  // so long recordings don't pile up in memory as JavaScript arrays.
  const blobs = [];
  let pending = [];
  let pendingBytes = 0;
  let dataBytes = 0;
  const pack = () => {
    if (!pending.length) return;
    blobs.push(new Blob(pending));
    pending = [];
    pendingBytes = 0;
  };
  node.port.onmessage = ({ data: { left, right } }) => {
    const out = new Int16Array(left.length * 2);
    for (let i = 0; i < left.length; i++) {
      out[i * 2] = toInt16(left[i]);
      out[i * 2 + 1] = toInt16(right[i]);
    }
    pending.push(out.buffer);
    pendingBytes += out.byteLength;
    dataBytes += out.byteLength;
    if (pendingBytes > 4 * 1024 * 1024) pack();
  };
  source.connect(node);
  node.connect(ctx.destination); // outputs silence; connecting keeps the node running
  session.wav = { node, blobs, pack, getBytes: () => dataBytes };
}

function toInt16(s) {
  const v = Math.max(-1, Math.min(1, s));
  return v < 0 ? v * 0x8000 : v * 0x7fff;
}

function wavHeader(dataBytes, sampleRate, channels = 2) {
  const h = new DataView(new ArrayBuffer(44));
  const str = (o, s) => [...s].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  h.setUint32(4, 36 + dataBytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  h.setUint32(16, 16, true);
  h.setUint16(20, 1, true); // PCM
  h.setUint16(22, channels, true);
  h.setUint32(24, sampleRate, true);
  h.setUint32(28, sampleRate * channels * 2, true);
  h.setUint16(32, channels * 2, true);
  h.setUint16(34, 16, true);
  str(36, 'data');
  h.setUint32(40, dataBytes, true);
  return h.buffer;
}

async function stop() {
  if (!session) return;
  const s = session;
  if (s.recorder) {
    if (s.recorder.state !== 'inactive') s.recorder.stop(); // onstop calls finish()
    s.stream.getTracks().forEach((t) => t.stop());
    return;
  }
  if (s.wav) {
    // Ask the worklet for its last partial batch, then give it a moment to arrive.
    s.wav.node.port.postMessage('flush');
    await new Promise((r) => setTimeout(r, 150));
    s.source.disconnect();
    s.stream.getTracks().forEach((t) => t.stop());
    s.wav.pack();
    const bytes = s.wav.getBytes();
    const blob = new Blob([wavHeader(bytes, s.ctx.sampleRate), ...s.wav.blobs], { type: 'audio/wav' });
    finish(blob, 'wav', bytes === 0);
  }
}

function finish(blob, ext, empty = false) {
  session?.ctx.close();
  session = null;
  if (empty || blob.size < 100) {
    chrome.runtime.sendMessage({ target: 'background', type: 'finished', error: 'Nothing was recorded.' });
    return;
  }
  // The background script can't make blob URLs, so this page makes one and keeps it
  // alive until the download is done (the background then closes this page).
  const url = URL.createObjectURL(blob);
  chrome.runtime.sendMessage({ target: 'background', type: 'finished', url, ext });
}
