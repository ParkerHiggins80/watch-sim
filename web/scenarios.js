// Scenarios: the whole dev tools state saved under a name, like "low battery while
// charging". They're JSON files in the firmware repo's scenarios/ folder, so they get
// committed with your code and follow you to other machines. build/serve.py reads and
// writes them; on a plain static server you can still export and import files.
'use strict';

const SCENARIO_VERSION = 1;

// Built-in examples. Each is a partial state: whatever it leaves out gets its default.
const EXAMPLE_SCENARIOS = (() => {
  const notif = (id, app, category, title, message) => ({ id, app, category, flags: 0, title, message });
  const sms = BLE_CATEGORY.SOCIAL;
  return {
    'Board as it is now (defaults)': {},
    'Low battery while charging': {
      fuel_gauge: { enabled: true, percent: 6, mv: curveMv(6), sim: { running: true, speed: 60 } },
      charger: { usb: true, mode: 'charging' },
    },
    'Notification burst while disconnected': {
      ble: {
        link: 'disconnected', nextId: 11,
        notifs: Array.from({ length: 10 }, (_, i) =>
          notif(i + 1, 'com.apple.MobileSMS', sms, ['Anna', 'Sam Lee', 'Jordan'][i % 3], `Message ${i + 1} of 10`)),
      },
    },
    'Incoming call while music plays': {
      ble: {
        link: 'bonded', nextId: 2,
        notifs: [{ ...notif(1, 'com.apple.mobilephone', BLE_CATEGORY.INCOMING_CALL, 'Alex Kim', 'Incoming Call'),
                   flags: BLE_FLAG.POSITIVE | BLE_FLAG.NEGATIVE }],
        music: { ...SAMPLE_TRACKS[0], state: MUSIC_STATE.PLAYING, positionMs: 62000, volume: 60 },
      },
    },
    'Every I²C chip not responding': {
      imu: { enabled: false }, haptic: { enabled: false }, fuel_gauge: { enabled: false }, rtc: { enabled: false },
    },
    'Out walking, battery draining': {
      imu: { motion: 'walking' },
      fuel_gauge: { enabled: true, percent: 35, mv: curveMv(35), sim: { running: true, loadMa: 25, speed: 600 } },
      ble: { link: 'bonded' },
    },
  };
})();

// opts: { reset() } restarts the watch
function createScenarios(hw, opts) {
  const root = document.getElementById('devtools');
  let server = false;      // build/serve.py is there to read and write the repo's files
  let dir = '';            // "Smartwatch/scenarios"
  let saved = [];          // [{ file, name }]

  const el = (tag, props = {}, ...children) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e[k] = v;
    }
    e.append(...children.filter((c) => c !== null && c !== undefined));
    return e;
  };

  const picker = el('select', { onchange: pickerChanged, title: 'Saved scenarios and built-in examples' });
  const loadBtn = el('button', { class: 'primary', onclick: loadPicked }, 'Load');
  const deleteBtn = el('button', { onclick: deletePicked, title: 'Delete this scenario file from the repo' }, 'Delete');
  const restart = el('input', { type: 'checkbox', checked: loadPref('scenarios.restart', true),
                                onchange: () => savePref('scenarios.restart', restart.checked) });
  const nameEl = el('input', { type: 'text', class: 'wide', placeholder: 'Name, e.g. Low battery while charging' });
  const saveBtn = el('button', { class: 'primary', onclick: saveCurrent }, 'Save');
  const fileInput = el('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: importFile });
  const status = el('div', { class: 'hint' });
  const where = el('div', { class: 'hint' });

  const say = (text, bad) => { status.textContent = text; status.classList.toggle('err', !!bad); };

  const body = el('div', { class: 'body' },
    el('div', { class: 'row' }, picker, loadBtn, deleteBtn),
    el('div', { class: 'row' }, el('label', { title: 'Start the firmware fresh in the loaded setup. ' +
      'Untick to change the hardware under the running watch: it gets link, notification and music events as if the phone changed.' },
      restart, 'Restart the watch on load')),
    el('div', { class: 'row' }, nameEl, saveBtn),
    el('div', { class: 'row' },
      el('button', { onclick: exportFile, title: 'Download the current setup as a .json file' }, 'Export file…'),
      el('button', { onclick: () => fileInput.click(), title: 'Load a scenario .json file' }, 'Import file…'),
      fileInput),
    where, status);
  const details = el('details', { class: 'dev', open: loadPref('devtools.open.scenarios', true) },
    el('summary', {}, el('b', {}, 'Scenarios'), el('span', { class: 'chip' }, 'save and load the whole setup')), body);
  details.ontoggle = () => savePref('devtools.open.scenarios', details.open);
  root.prepend(details);

  // ---- The picker: the repo's files, then the examples ----

  function fillPicker(keep) {
    const groups = [];
    if (server) {
      const g = el('optgroup', { label: `In ${dir}/` });
      for (const s of saved) g.append(new Option(s.name + (s.error ? ' (broken)' : ''), 'file:' + s.file));
      if (!saved.length) g.append(el('option', { disabled: true }, '(none saved yet)'));
      groups.push(g);
    }
    const ex = el('optgroup', { label: 'Examples' });
    for (const name of Object.keys(EXAMPLE_SCENARIOS)) ex.append(new Option(name, 'example:' + name));
    groups.push(ex);
    picker.replaceChildren(...groups);
    if (keep && [...picker.options].some((o) => o.value === keep)) picker.value = keep;
    pickerChanged();
  }

  function pickerChanged() {
    const isFile = picker.value.startsWith('file:');
    deleteBtn.hidden = !isFile;
    deleteBtn.textContent = 'Delete';
    if (isFile) nameEl.value = picker.selectedOptions[0].textContent.replace(/ \(broken\)$/, '');
  }

  async function refreshList(keep = picker.value) {
    if (server) {
      try {
        ({ dir, scenarios: saved } = await api('scenarios'));
      } catch (e) {
        say('Could not list scenarios: ' + e.message, true);
      }
    }
    where.textContent = server
      ? `Saved as JSON in ${dir}/ (commit them with your code). Save overwrites one with the same name.`
      : 'No build/serve.py here, so nothing can be saved to the repo. Export and import files instead.';
    saveBtn.disabled = !server;
    fillPicker(keep);
  }

  // ---- Loading ----

  function apply(state, label) {
    const live = !restart.checked;
    hw.load(state, { live });
    if (!live) opts.reset();
    say(`Loaded "${label}"` + (live ? ' into the running watch.' : ' and restarted the watch.'));
  }

  async function loadPicked() {
    const v = picker.value;
    if (v.startsWith('example:')) {
      const name = v.slice(8);
      return apply(EXAMPLE_SCENARIOS[name], name);
    }
    if (!v.startsWith('file:')) return;
    try {
      const doc = await api('scenario?file=' + encodeURIComponent(v.slice(5)));
      if (doc.error || !doc.state) throw new Error(doc.error || 'no "state" in the file');
      apply(doc.state, doc.name || v.slice(5));
    } catch (e) {
      say(`Could not load ${v.slice(5)}: ${e.message}`, true);
    }
  }

  // ---- Saving ----

  const docFor = (name) => ({ name, version: SCENARIO_VERSION, saved: new Date().toISOString(), state: hw.snapshot() });

  async function saveCurrent() {
    const name = nameEl.value.trim();
    if (!name) return say('Type a name first.', true);
    try {
      const res = await api('scenario', docFor(name));
      if (res.error) throw new Error(res.error);
      await refreshList('file:' + res.file);
      say(`Saved "${name}" to ${dir}/${res.file}.`);
    } catch (e) {
      say('Could not save: ' + e.message, true);
    }
  }

  // Two clicks, so a slip doesn't delete a file (confirm() is blocked in some VS Code panes)
  async function deletePicked() {
    if (deleteBtn.textContent === 'Delete') {
      deleteBtn.textContent = 'Really delete?';
      setTimeout(() => { deleteBtn.textContent = 'Delete'; }, 3000);
      return;
    }
    const file = picker.value.slice(5);
    try {
      const res = await api('scenario-delete', { file });
      if (res.error) throw new Error(res.error);
      await refreshList('');
      say(`Deleted ${dir}/${file}.`);
    } catch (e) {
      say('Could not delete: ' + e.message, true);
    }
  }

  // ---- Files, for when there's no server ----

  function exportFile() {
    const name = nameEl.value.trim() || 'scenario';
    const blob = new Blob([JSON.stringify(docFor(name), null, 2) + '\n'], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob),
                        download: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.json' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function importFile() {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    try {
      const doc = JSON.parse(await f.text());
      if (!doc.state) throw new Error('no "state" in the file');
      nameEl.value = doc.name || f.name.replace(/\.json$/, '');
      apply(doc.state, nameEl.value);
    } catch (e) {
      say(`Could not import ${f.name}: ${e.message}`, true);
    }
  }

  refreshList('');

  return {
    // Called once the page knows whether build/serve.py is there, and when the repo changes
    setServer(available) {
      server = available;
      return refreshList(available ? picker.value : '');
    },
    refreshList: () => refreshList(),
  };
}
