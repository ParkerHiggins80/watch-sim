// Starts the compiled watch (watch.js / watch.wasm) and draws its frames on the canvas.
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

function log(text, cls) {
  const line = document.createElement('div');
  line.textContent = text;
  if (cls) line.className = cls;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

// ---- Running the watch ----

let watch = null;   // the running copy of the compiled firmware

// Loads watch.js (which defines createWatch) and starts a fresh copy. The old copy is
// stopped first, like pressing reset on the real watch.
function startWatch(version) {
  const script = document.createElement('script');
  script.src = 'watch.js?v=' + version;
  script.onload = () => {
    script.remove();
    if (watch) {
      watch._sim_stop();
      watch = null;
    }
    createWatch({
      locateFile: (file) => file + '?v=' + version,   // fetch the matching watch.wasm

      // printf() in C ends up here
      print: (text) => log(text),
      printErr: (text) => log(text, 'err'),

      // sim/main.c calls this after LVGL redraws. px points at 466x466 RGBA bytes in WASM memory.
      onFrame(px, w, h) {
        const bytes = new Uint8ClampedArray(this.HEAPU8.buffer, px, w * h * 4);
        ctx.putImageData(new ImageData(bytes, w, h), 0, 0);
      },
    }).then((m) => { watch = m; })
      .catch((e) => log('Failed to start: ' + e, 'err'));
  };
  script.onerror = () => {
    script.remove();
    log('No build yet. Press Compile, or run build/build.sh.', 'err');
  };
  document.body.appendChild(script);
}

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
    log(`── build ${s.id}: restarted ──`, 'sep');
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
