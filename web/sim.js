// Starts the compiled watch (watch.js / watch.wasm) and draws its frames on the canvas.
// The mouse is the touch screen; the zoom and throttle controls are under "Display".
// The simulated hardware (web/devices.js) outlives each copy of the watch; the dev
// tools panel (web/devtools.js) shows and changes it.
// When served by build/serve.py it also shows the compile toolbar, restarts the watch
// after each good build (no page reload, so page state survives) and lists build errors.
'use strict';

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const logEl = document.getElementById('log');
const errorsEl = document.getElementById('errors');
const toolbar = document.getElementById('toolbar');
const repoEl = document.getElementById('repo');
const compileBtn = document.getElementById('compile');
const autoEl = document.getElementById('autocompile');
const statusEl = document.getElementById('status');

// Settings that belong to this browser (zoom, calibration, throttle). Storage can be
// unavailable (private windows), so failures just mean the defaults are used.
function loadPref(key, fallback) {
  try {
    const v = localStorage.getItem('watch-sim.' + key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function savePref(key, value) {
  try {
    localStorage.setItem('watch-sim.' + key, JSON.stringify(value));
  } catch { /* not saved; fine */ }
}

function append(box, line) {
  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 4;
  box.appendChild(line);
  while (box.childElementCount > 2000) box.firstChild.remove();
  if (atBottom) box.scrollTop = box.scrollHeight;   // don't jump while you're reading older lines
}

// Console: everything the firmware prints, like the RTT log on the watch
function log(text, cls) {
  const line = document.createElement('div');
  line.textContent = text;
  if (cls) line.className = cls;
  append(logEl, line);
}

// Action log: every call from the firmware to the hardware layer, with the time since boot
const actionsEl = document.getElementById('actions');

function logAction(device, text, ms) {
  const line = document.createElement('div');
  line.className = 'act' + (/ -> -/.test(text) ? ' err' : '');
  const t = document.createElement('span');
  t.className = 't';
  t.textContent = (ms / 1000).toFixed(3).padStart(9) + '  ';
  const dev = document.createElement('span');
  dev.className = 'dev';
  dev.textContent = device.padEnd(11);
  line.append(t, dev, text);
  append(actionsEl, line);
  tools.onAction(device, text, ms);
}

function logSeparator(text) {
  log(text, 'sep');
  const line = document.createElement('div');
  line.className = 'sep';
  line.textContent = text;
  append(actionsEl, line);
}

for (const tab of document.querySelectorAll('.tabs [data-tab]')) {
  tab.onclick = () => {
    for (const t of document.querySelectorAll('.tabs [data-tab]')) {
      t.classList.toggle('active', t === tab);
      document.getElementById(t.dataset.tab).hidden = t !== tab;
    }
  };
}
document.getElementById('clearLogs').onclick = () => {
  (logEl.hidden ? actionsEl : logEl).replaceChildren();
};

// ---- Simulated hardware ----

const hw = createHardware({
  onHaptic: (h) => tools.onHaptic(h),
  onChange: () => tools.refresh(),
});
window.hw = hw;   // poke it from the browser's dev tools console while testing

const tools = createDevtools(hw, { reset: resetWatch, usbMode: enterUsbMode });

const devtoolsEl = document.getElementById('devtools');
const showDevtools = document.getElementById('showDevtools');
showDevtools.checked = loadPref('devtools', true);
devtoolsEl.hidden = !showDevtools.checked;
showDevtools.onchange = () => {
  savePref('devtools', showDevtools.checked);
  devtoolsEl.hidden = !showDevtools.checked;
};

// ---- Running the watch ----

let watch = null;   // the running copy of the compiled firmware
let watchVersion = 0;
const usbEl = document.getElementById('usb');

// Loads watch.js (which defines createWatch) and starts a fresh copy. The old copy is
// stopped first, like pressing reset on the real watch.
function startWatch(version) {
  watchVersion = version;
  usbEl.hidden = true;
  const script = document.createElement('script');
  script.src = 'watch.js?v=' + version;
  script.onload = () => {
    script.remove();
    if (watch) {
      watch._sim_stop();
      watch = null;
    }
    hw.reset();   // like a real reset: pending interrupts and events are lost
    createWatch({
      hw,
      onAction: logAction,
      onSystem,

      locateFile: (file) => file + '?v=' + version,   // fetch the matching watch.wasm

      // printf() in C ends up here
      print: (text) => log(text),
      printErr: (text) => log(text, 'err'),

      // sim/main.c calls this after LVGL redraws. px points at 466x466 RGBA bytes in WASM memory.
      onFrame(px, w, h) {
        const bytes = new Uint8ClampedArray(this.HEAPU8.buffer, px, w * h * 4);
        ctx.putImageData(new ImageData(bytes, w, h), 0, 0);
      },
    }).then((m) => {
      watch = m;
      watch._sim_set_throttle(throttleEl.checked ? PANEL.fullFrameMs : 0);
    })
      .catch((e) => log('Failed to start: ' + e, 'err'));
  };
  script.onerror = () => {
    script.remove();
    log('No build yet. Press Compile, or run build/build.sh.', 'err');
  };
  document.body.appendChild(script);
}

// system_reboot() and system_enter_usb_mode() from the firmware
function onSystem(what) {
  watch = null;   // the C side has already stopped itself
  if (what === 'reboot') {
    logSeparator('── reset ──');
    setTimeout(() => startWatch(watchVersion), 200);
  } else {
    usbEl.hidden = false;
  }
}
document.getElementById('usbRestart').onclick = resetWatch;

// The reset and USB mode that PB1 / PB2 in the dev tools do (as src/main.c does)
function stopWatch() {
  if (watch) watch._sim_stop();
  watch = null;
}
function resetWatch() {
  stopWatch();
  logSeparator('── reset ──');
  startWatch(watchVersion);
}
function enterUsbMode() {
  stopWatch();
  logSeparator('── USB mode ──');
  usbEl.hidden = false;
}

// ---- Display: zoom modes and calibration ----

const displayEl = document.getElementById('display');
const watchEl = document.getElementById('watch');
const zoomEl = document.getElementById('zoom');
const zoomHint = document.getElementById('zoomHint');
const throttleEl = document.getElementById('throttle');
const calDialog = document.getElementById('calibration');
const cardEl = document.getElementById('card');
const cardSize = document.getElementById('cardSize');

const CARD_MM = { w: 85.60, h: 53.98, r: 3.18 };   // ISO/IEC 7810 ID-1 card
const CSS_PX_PER_MM = 96 / 25.4;   // what CSS assumes; real screens differ, hence calibration

// CSS pixels per real millimetre on this screen (null until calibrated)
let pxPerMm = loadPref('pxPerMm', null);

// Size of the watch in CSS pixels for the current zoom mode
function watchSize() {
  switch (zoomEl.value) {
    case '1:1':   // one panel pixel per screen pixel, whatever the browser zoom
      return PANEL.width / window.devicePixelRatio;
    case 'real':
      return PANEL.diameterMm * (pxPerMm || CSS_PX_PER_MM);
    default: {    // fit: as big as the pane allows, leaving room for the bezel
      const pad = 12;
      return Math.max(100, Math.min(displayEl.clientWidth, displayEl.clientHeight) - pad);
    }
  }
}

function layout() {
  const size = watchSize();
  watchEl.style.width = watchEl.style.height = size + 'px';
  // Sharp pixels when the panel is blown up; smooth scaling when it's shrunk
  canvas.classList.toggle('pixelated', size * window.devicePixelRatio >= PANEL.width);

  if (zoomEl.value === 'real') {
    zoomHint.textContent = `${PANEL.diameterMm} mm` + (pxPerMm ? '' : ' (not calibrated)');
  } else {
    zoomHint.textContent = `${Math.round(size * window.devicePixelRatio / PANEL.width * 100)}%`;
  }
}

zoomEl.value = loadPref('zoom', 'fit');
zoomEl.onchange = () => { savePref('zoom', zoomEl.value); layout(); };
new ResizeObserver(layout).observe(displayEl);
window.addEventListener('resize', layout);   // also fires when the browser zoom changes

function drawCard() {
  const v = Number(cardSize.value);
  cardEl.style.width = CARD_MM.w * v + 'px';
  cardEl.style.height = CARD_MM.h * v + 'px';
  cardEl.style.borderRadius = CARD_MM.r * v + 'px';
}

document.getElementById('calibrate').onclick = () => {
  cardSize.value = pxPerMm || CSS_PX_PER_MM;
  drawCard();
  calDialog.showModal();
};
cardSize.oninput = drawCard;
document.getElementById('calReset').onclick = () => { cardSize.value = CSS_PX_PER_MM; drawCard(); };
document.getElementById('calCancel').onclick = () => calDialog.close();
document.getElementById('calSave').onclick = () => {
  pxPerMm = Number(cardSize.value);
  savePref('pxPerMm', pxPerMm);
  calDialog.close();
  zoomEl.value = 'real';
  savePref('zoom', 'real');
  layout();
};

// ---- Throttle ----

throttleEl.checked = loadPref('throttle', false);
throttleEl.onchange = () => {
  savePref('throttle', throttleEl.checked);
  if (watch) watch._sim_set_throttle(throttleEl.checked ? PANEL.fullFrameMs : 0);
};

// ---- Touch: the mouse acts as a finger on the round glass ----
// Presses outside the circle are ignored, and dragging off the edge lifts the finger,
// because the real touch panel is round too. LVGL handles taps, drags and long presses.

let touching = false;

function panelPoint(e) {
  const r = canvas.getBoundingClientRect();
  const x = Math.round((e.clientX - r.left) * PANEL.width / r.width);
  const y = Math.round((e.clientY - r.top) * PANEL.height / r.height);
  const cx = PANEL.width / 2, cy = PANEL.height / 2;
  const inside = (x - cx) ** 2 + (y - cy) ** 2 <= cx * cy;
  return { x, y, inside };
}

function sendTouch(p, down) {
  Object.assign(hw.touch, { x: p.x, y: p.y, down });   // shown in the dev tools
  tools.refresh();
  if (!hw.state.touch.enabled) down = false;   // touch set to Not responding in the dev tools
  touching = down;
  if (watch) watch._sim_touch(p.x, p.y, down ? 1 : 0);
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const p = panelPoint(e);
  if (!p.inside) return;
  canvas.setPointerCapture(e.pointerId);   // keep getting moves if the mouse leaves the canvas
  sendTouch(p, true);
});
canvas.addEventListener('pointermove', (e) => {
  if (!touching) return;
  const p = panelPoint(e);
  sendTouch(p, p.inside);
});
for (const type of ['pointerup', 'pointercancel']) {
  canvas.addEventListener(type, (e) => {
    if (touching) sendTouch(panelPoint(e), false);
  });
}

layout();

// ---- Compiling (only when the page is served by build/serve.py) ----

async function api(path, body) {
  const opts = body === undefined ? {} :
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch('api/' + path, opts);
  if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
  return res.json();
}

// /workspaces/Smartwatch/ui/ui.c -> Smartwatch/ui/ui.c
function shortPath(file, repo) {
  const i = file.indexOf('/' + repo + '/');
  return i >= 0 ? file.slice(i + 1) : file;
}

function showErrors(status) {
  errorsEl.replaceChildren();
  const diags = status.diagnostics || [];
  const errors = diags.filter((d) => d.severity === 'error');

  const h = document.createElement('h2');
  h.textContent = errors.length ? `Build failed: ${errors.length} error${errors.length > 1 ? 's' : ''}`
                                : 'Build failed';
  errorsEl.appendChild(h);

  for (const d of diags) {
    const div = document.createElement('div');
    div.className = 'diag ' + d.severity;
    const where = document.createElement('span');
    where.className = 'where';
    where.textContent = shortPath(d.file, status.repo) + (d.line ? `:${d.line}:${d.col}` : '');
    const sev = document.createElement('span');
    sev.className = 'sev';
    sev.textContent = ` ${d.severity}: `;
    div.append(where, sev, d.message);
    errorsEl.appendChild(div);
  }

  // Full compiler output, open when nothing could be parsed (CMake errors and the like)
  const details = document.createElement('details');
  details.open = diags.length === 0;
  const summary = document.createElement('summary');
  summary.textContent = 'Full build output';
  const pre = document.createElement('pre');
  pre.textContent = status.output || '';
  details.append(summary, pre);
  errorsEl.appendChild(details);

  errorsEl.hidden = false;
}

function showStatus(s) {
  compileBtn.disabled = s.state === 'building';
  autoEl.checked = !!s.autocompile;
  statusEl.className = s.state || '';
  statusEl.title = '';
  if (s.state === 'building') {
    statusEl.textContent = `Building ${s.repo}…`;
  } else if (s.state === 'ok') {
    const warnings = (s.diagnostics || []).filter((d) => d.severity === 'warning').length;
    const secs = (s.finished - s.started).toFixed(1);
    statusEl.textContent = `Built in ${secs} s` + (warnings ? `, ${warnings} warning${warnings > 1 ? 's' : ''}` : '');
    if (warnings) statusEl.title = 'Warnings are listed in the log below and in the Problems panel (Ctrl+Shift+B)';
  } else if (s.state === 'failed') {
    const errors = (s.diagnostics || []).filter((d) => d.severity === 'error').length;
    statusEl.textContent = errors ? `${errors} error${errors > 1 ? 's' : ''}` : 'Build failed';
  } else {
    statusEl.textContent = '';
  }
}

// A build finished (from the button, Ctrl+Shift+B, auto compile or the terminal)
function onBuildDone(s) {
  if (s.state === 'ok') {
    errorsEl.hidden = true;
    logSeparator(`── build ${s.id}: restarted ──`);
    for (const d of s.diagnostics || []) {
      log(`${shortPath(d.file, s.repo)}:${d.line}:${d.col}: warning: ${d.message}`, 'err');
    }
    startWatch(s.id);
  } else {
    showErrors(s);
  }
}

async function loadRepos() {
  const { repos, selected } = await api('repos');
  repoEl.replaceChildren(...repos.map((name) => new Option(name, name, false, name === selected)));
}

async function initCompile() {
  let status;
  try {
    status = await api('status');
  } catch {
    return false;   // plain static server: no compile toolbar
  }
  toolbar.hidden = false;
  await loadRepos();

  compileBtn.onclick = () => api('build', {});
  repoEl.onchange = () => api('select', { repo: repoEl.value });
  autoEl.onchange = () => api('autocompile', { enabled: autoEl.checked });

  let seen = status.id || 0;
  showStatus(status);
  if (status.state === 'failed') showErrors(status);
  startWatch(seen);   // the last good build, even if the latest one failed

  setInterval(async () => {
    try {
      const s = await api('status');
      showStatus(s);
      if ((s.id || 0) !== seen && s.state !== 'building') {
        seen = s.id;
        onBuildDone(s);
      }
    } catch {
      statusEl.className = 'failed';
      statusEl.textContent = 'Server not running (tools/start-server.sh)';
    }
  }, 1000);
  return true;
}

initCompile().then((ok) => { if (!ok) startWatch(0); });
