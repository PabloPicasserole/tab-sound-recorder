// Background coordinator. The popup asks it to start/stop; it runs the recording inside an
// offscreen document (service workers can't use MediaRecorder) and hands the finished file
// to Chrome's downloads, which is the only way an extension can write a file to disk.

const OFFSCREEN_URL = 'offscreen.html';

// Keep in sync with popup.js.
const DEFAULT_SETTINGS = { format: 'wav', askWhere: true, folder: 'Recordings' };

async function getState() {
  const { rec } = await chrome.storage.session.get('rec');
  return rec || { recording: false };
}
const setState = (rec) => chrome.storage.session.set({ rec });

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'Record the audio of the current tab.'
  });
}

async function closeOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length) await chrome.offscreen.closeDocument();
}

function setBadge(on) {
  chrome.action.setBadgeText({ text: on ? 'REC' : '' });
  if (on) chrome.action.setBadgeBackgroundColor({ color: '#eb5757' });
}

// Turn a tab title into a safe file name.
function cleanName(title) {
  const name = (title || 'Recording')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 80);
  return name || 'Recording';
}
function cleanFolder(folder) {
  return (folder || '')
    .split(/[\\/]+/)
    .map((p) => p.replace(/[<>:"|?*\u0000-\u001f]/g, ' ').replace(/[. ]+$/, '').trim())
    .filter((p) => p && p !== '..' && p !== '.')
    .join('/');
}
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}

async function start({ streamId, tabId, tabTitle }) {
  const state = await getState();
  if (state.recording) return { ok: false, error: 'Already recording.' };
  const settings = { ...DEFAULT_SETTINGS, ...(await chrome.storage.sync.get(DEFAULT_SETTINGS)) };
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'start', streamId, format: settings.format });
  if (!res?.ok) {
    await closeOffscreen();
    return { ok: false, error: res?.error || 'Could not start recording.' };
  }
  await setState({ recording: true, tabId, tabTitle, startedAt: Date.now() });
  setBadge(true);
  return { ok: true };
}

async function stop() {
  const state = await getState();
  if (!state.recording) return { ok: false, error: 'Not recording.' };
  await setState({ ...state, recording: false, saving: true });
  // The offscreen page replies later with a 'finished' message carrying the file URL.
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' }).catch(() => {});
  return { ok: true };
}

async function finished({ url, ext, error }) {
  const state = await getState();
  setBadge(false);
  if (error || !url) {
    await setState({ recording: false, lastError: error || 'Nothing was recorded.' });
    await closeOffscreen();
    return;
  }
  const settings = { ...DEFAULT_SETTINGS, ...(await chrome.storage.sync.get(DEFAULT_SETTINGS)) };
  // In "ask" mode Chrome's Save dialog opens in the last folder you used, so no subfolder.
  const folder = settings.askWhere ? '' : cleanFolder(settings.folder);
  const file = `${cleanName(state.tabTitle)} ${stamp(new Date(state.startedAt || Date.now()))}.${ext}`;
  try {
    const downloadId = await chrome.downloads.download({
      url,
      filename: folder ? `${folder}/${file}` : file,
      saveAs: settings.askWhere,
      conflictAction: 'uniquify'
    });
    await setState({ recording: false, saving: true, pendingDownload: downloadId, pendingFile: file });
  } catch (e) {
    await setState({ recording: false, lastError: `Saving failed: ${e.message}` });
    await closeOffscreen();
  }
}

// Close the offscreen page (and free the recording from memory) once the download is done
// or the Save dialog was cancelled.
chrome.downloads.onChanged.addListener(async (delta) => {
  const state = await getState();
  if (delta.id !== state.pendingDownload || !delta.state) return;
  if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
    const cancelled = delta.state.current === 'interrupted';
    await setState({
      recording: false,
      lastFile: cancelled ? undefined : state.pendingFile,
      lastError: cancelled ? 'Saving was cancelled.' : undefined
    });
    await closeOffscreen();
  }
});

// If the recorded tab is closed, stop and save what we have.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getState();
  if (state.recording && state.tabId === tabId) stop();
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.target !== 'background') return;
  const handlers = { start, stop, finished, ended: stop };
  const fn = handlers[msg.type];
  if (!fn) return;
  fn(msg).then(reply, (e) => reply({ ok: false, error: e.message }));
  return true; // async reply
});

// Clear a stale state after the browser restarts.
chrome.runtime.onStartup.addListener(() => { setState({ recording: false }); setBadge(false); });
