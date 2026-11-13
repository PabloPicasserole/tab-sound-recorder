// Keep in sync with service-worker.js.
const DEFAULT_SETTINGS = { format: 'wav', askWhere: true, folder: 'Recordings' };
const FORMAT_HINTS = {
  wav: 'Plays everywhere, full quality. About 10 MB per minute.',
  webm: 'Small, about 1.5 MB per minute. Plays in Chrome and VLC.'
};

const $ = (id) => document.getElementById(id);
let timerId = null;
let activeTab = null;

function fmt(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
  const s = String(t % 60).padStart(2, '0');
  return h ? `${h}:${m}:${s}` : `${m}:${s}`;
}

function setMessage(text, kind = '') {
  $('message').textContent = text || '';
  $('message').dataset.kind = kind;
}

function render(rec) {
  const recording = !!rec.recording;
  const saving = !!rec.saving;
  const state = recording ? 'recording' : saving ? 'saving' : rec.lastFile ? 'saved' : 'ready';

  $('status').dataset.state = state;
  $('statusText').textContent = { recording: 'Recording', saving: 'Saving', saved: 'Saved', ready: 'Ready' }[state];

  $('sourceLabel').textContent = recording ? 'Recording' : 'This tab';
  $('source').textContent = recording ? rec.tabTitle : (activeTab?.title || 'This tab');
  $('source').title = $('source').textContent;

  clearInterval(timerId);
  if (recording) {
    const tick = () => { $('timer').textContent = fmt(Date.now() - rec.startedAt); };
    tick();
    timerId = setInterval(tick, 250);
  } else {
    $('timer').textContent = '00:00';
  }

  $('toggle').disabled = saving;
  $('toggleText').textContent = recording ? 'Stop and save' : saving ? 'Saving…' : 'Start recording';
  $('iconRec').hidden = recording;
  $('iconStop').hidden = !recording;
  $('settings').setAttribute('aria-disabled', String(recording || saving));

  if (rec.lastError) setMessage(rec.lastError, 'error');
  else if (rec.lastFile) setMessage(`Saved “${rec.lastFile}”.`);
  else if (recording) setMessage('Keep the tab open. You can close this popup.');
  else setMessage('');
}

async function refresh() {
  const { rec } = await chrome.storage.session.get('rec');
  render(rec || { recording: false });
}

function isRecordable(url = '') {
  return /^(https?|file):/i.test(url) && !/^https:\/\/chromewebstore\.google\.com/i.test(url);
}

async function toggle() {
  const { rec } = await chrome.storage.session.get('rec');
  if (rec?.recording) {
    await chrome.runtime.sendMessage({ target: 'background', type: 'stop' });
    return;
  }
  if (!activeTab || !isRecordable(activeTab.url)) {
    setMessage('Chrome doesn’t allow recording this page. Open a normal website tab and try again.', 'error');
    return;
  }
  $('toggle').disabled = true;
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: activeTab.id });
    const res = await chrome.runtime.sendMessage({
      target: 'background', type: 'start', streamId, tabId: activeTab.id, tabTitle: activeTab.title
    });
    if (!res?.ok) setMessage(res?.error || 'Could not start recording.', 'error');
  } catch (e) {
    setMessage(e.message, 'error');
  } finally {
    refresh();
  }
}

async function loadSettings() {
  const s = { ...DEFAULT_SETTINGS, ...(await chrome.storage.sync.get(DEFAULT_SETTINGS)) };
  document.querySelector(`input[name="format"][value="${s.format}"]`).checked = true;
  document.querySelector(`input[name="where"][value="${s.askWhere ? 'ask' : 'auto'}"]`).checked = true;
  $('folder').value = s.folder;
  $('formatHint').textContent = FORMAT_HINTS[s.format];
  $('folderRow').hidden = s.askWhere;
}

function wireSettings() {
  document.querySelectorAll('input[name="format"]').forEach((el) => el.addEventListener('change', () => {
    chrome.storage.sync.set({ format: el.value });
    $('formatHint').textContent = FORMAT_HINTS[el.value];
  }));
  document.querySelectorAll('input[name="where"]').forEach((el) => el.addEventListener('change', () => {
    const askWhere = el.value === 'ask';
    chrome.storage.sync.set({ askWhere });
    $('folderRow').hidden = askWhere;
  }));
  $('folder').addEventListener('input', () => chrome.storage.sync.set({ folder: $('folder').value.trim() }));
}

chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.rec) render(changes.rec.newValue || { recording: false });
});

(async () => {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await loadSettings();
  wireSettings();
  $('toggle').addEventListener('click', toggle);
  await refresh();
})();
