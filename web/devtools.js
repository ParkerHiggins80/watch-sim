// The dev tools panel: one section per device on the watch, each with an Enabled /
// Not responding switch. Every control reads and writes the simulated hardware in
// web/devices.js, so the panel only shows state; it keeps none of its own (apart from
// half-typed form fields). refresh() redraws it from the hardware state.
'use strict';

// ---- DRV2605L built-in effects (datasheet "Waveform Library Effects List") ----
// Durations are estimates: TI doesn't publish them, and they depend on the motor.
const HAPTIC_EFFECTS = (() => {
  const list = [null];   // effects are numbered from 1
  const add = (name, ms, levels) => {
    for (const [i, lvl] of levels.entries()) {
      list.push({ name: name.replace('#', i + 1) + ' - ' + lvl, ms });
    }
  };
  add('Strong Click', 60, ['100%', '60%', '30%']);
  add('Sharp Click', 50, ['100%', '60%', '30%']);
  add('Soft Bump', 80, ['100%', '60%', '30%']);
  add('Double Click', 180, ['100%', '60%']);
  add('Triple Click', 280, ['100%']);
  add('Soft Fuzz', 300, ['60%']);
  add('Strong Buzz', 300, ['100%']);
  add('750 ms Alert', 750, ['100%']);
  add('1000 ms Alert', 1000, ['100%']);
  add('Strong Click #', 60, ['100%', '80%', '60%', '30%']);
  add('Medium Click #', 60, ['100%', '80%', '60%']);
  add('Sharp Tick #', 30, ['100%', '80%', '60%']);
  add('Short Double Click Strong #', 150, ['100%', '80%', '60%', '30%']);
  add('Short Double Click Medium #', 150, ['100%', '80%', '60%']);
  add('Short Double Sharp Tick #', 120, ['100%', '80%', '60%']);
  add('Long Double Sharp Click Strong #', 250, ['100%', '80%', '60%', '30%']);
  add('Long Double Sharp Click Medium #', 250, ['100%', '80%', '60%']);
  add('Long Double Sharp Tick #', 220, ['100%', '80%', '60%']);
  add('Buzz #', 300, ['100%', '80%', '60%', '40%', '20%']);
  add('Pulsing Strong #', 600, ['100%', '60%']);
  add('Pulsing Medium #', 600, ['100%', '60%']);
  add('Pulsing Sharp #', 500, ['100%', '60%']);
  add('Transition Click #', 40, ['100%', '80%', '60%', '40%', '20%', '10%']);
  add('Transition Hum #', 300, ['100%', '80%', '60%', '40%', '20%', '10%']);
  for (const [dir, range] of [['Down', '100 to 0%'], ['Up', '0 to 100%'], ['Down', '50 to 0%'], ['Up', '0 to 50%']]) {
    for (const [len, ms] of [['Long', 600], ['Medium', 400], ['Short', 200]]) {
      add(`Transition Ramp ${dir} ${len} Smooth #`, ms, [range, range]);
    }
    for (const [len, ms] of [['Long', 600], ['Medium', 400], ['Short', 200]]) {
      add(`Transition Ramp ${dir} ${len} Sharp #`, ms, [range, range]);
    }
  }
  add('Long buzz for programmatic stopping', null, ['100%']);   // runs until haptic_stop()
  add('Smooth Hum # (no kick or brake)', 400, ['50%', '40%', '30%', '20%', '10%']);
  return list;
})();

const LONG_BUZZ_MS = 5000;   // how long the panel shows effect 118 if nothing stops it

// ---- Notification presets: app ids as iOS sends them ----
const NOTIF_PRESETS = {
  Messages:  { app: 'com.apple.MobileSMS', category: BLE_CATEGORY.SOCIAL,
               title: 'Anna', message: 'Running 10 min late, sorry!' },
  Mail:      { app: 'com.apple.mobilemail', category: BLE_CATEGORY.EMAIL,
               title: 'Sam Lee', message: 'Re: lab report draft' },
  Instagram: { app: 'com.burbn.instagram', category: BLE_CATEGORY.SOCIAL,
               title: 'Instagram', message: 'jordan_k liked your photo.' },
  Calendar:  { app: 'com.apple.mobilecal', category: BLE_CATEGORY.SCHEDULE,
               title: 'Team meeting', message: 'In 15 minutes, Room 204' },
  Other:     { app: 'com.example.app', category: BLE_CATEGORY.OTHER,
               title: 'Example', message: 'Something happened' },
};
// Longer than BLE_TEXT_MAX on purpose; the emoji checks that a cut never splits a character
const LONG_TEXT = {
  title: 'Alexandria Montgomery-Fitzgerald Jr.',
  message: 'Are we still on for dinner tonight? I booked a table for 7:30 at the new place 🍝',
};
const CATEGORY_NAMES = Object.fromEntries(Object.entries(BLE_CATEGORY).map(([k, v]) => [v, k]));
const BLE_TEXT_MAX = 32;   // hal/ble.h
const utf8Bytes = (s) => new TextEncoder().encode(s).length;

// ---- Small formatting helpers ----
const pad2 = (n) => String(n).padStart(2, '0');
const fmtMinSec = (ms) => `${Math.floor(ms / 60000)}:${pad2(Math.floor(ms / 1000) % 60)}`;
const fmtOffset = (min) => `UTC${min < 0 ? '−' : '+'}${Math.floor(Math.abs(min) / 60)}:${pad2(Math.abs(min) % 60)}`;
function fmtHours(h) {
  if (!isFinite(h)) return '–';
  if (h < 1 / 60) return `${Math.round(h * 3600)} s`;
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${Math.floor(h)} h ${pad2(Math.round(h * 60) % 60)} min`;
}
// Seconds since 1970 to "2026-10-20 14:03:22", reading the epoch as UTC (the watch's clocks have no zone)
function fmtEpoch(epoch) {
  const d = new Date(Math.floor(epoch) * 1000);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  return d.toISOString().slice(0, 19).replace('T', ' ') + ' ' + day;
}

// sim: { reset(), usbMode() } from sim.js
function createDevtools(hw, sim) {
  const root = document.getElementById('devtools');
  const S = hw.state;
  const updaters = [];   // each one redraws one control from S
  let pending = false;   // a redraw is waiting for the next frame

  // ---- Building blocks ----

  function el(tag, props = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e[k] = v;
    }
    e.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
    return e;
  }

  // Don't overwrite a field while you're typing in it or dragging it
  function setValue(input, v) {
    if (document.activeElement !== input && input.value !== String(v)) input.value = v;
  }

  const live = (fn) => { updaters.push(fn); return fn; };
  const row = (label, ...controls) => el('div', { class: 'row' }, label ? el('span', { class: 'lbl' }, label) : null, ...controls);
  const hint = (text) => el('div', { class: 'hint' }, text);
  const sub = (text) => el('div', { class: 'sub' }, text);
  const btn = (label, onclick, title) => el('button', { onclick, title: title || '' }, label);

  // Buttons where one is lit: options [[value, label]], get() returns the lit value
  function seg(options, get, set) {
    const buttons = options.map(([value, label]) => el('button', { onclick: () => set(value) }, label));
    live(() => buttons.forEach((b, i) => b.classList.toggle('on', options[i][0] === get())));
    return el('span', { class: 'seg' }, ...buttons);
  }

  function check(label, get, set, title) {
    const input = el('input', { type: 'checkbox', onchange: () => set(input.checked) });
    live(() => { input.checked = get(); });
    return el('label', { title: title || '' }, input, label);
  }

  // A slider plus a number box showing the same value
  function slider(label, { min, max, step, unit = '' }, get, set) {
    const range = el('input', { type: 'range', min, max, step, oninput: () => set(Number(range.value)) });
    const num = el('input', { type: 'number', min, max, step, class: 'num',
                              onchange: () => set(Number(num.value)) });
    const decimals = String(step).split('.')[1]?.length || 0;
    live(() => {
      setValue(range, get());
      setValue(num, Number(get()).toFixed(decimals));
    });
    return row(label, range, num, unit ? el('span', { class: 'unit' }, unit) : null);
  }

  function select(options, get, set) {
    const s = el('select', { onchange: () => set && set(s.value) },
                 ...options.map(([value, label]) => new Option(label, value)));
    if (get) live(() => setValue(s, get()));
    return s;
  }

  function text(get, cls) {
    const span = el('span', { class: cls || '' });
    live(() => { span.textContent = get(); });
    return span;
  }

  // A collapsible section. device: the key in hw.state that gets an Enabled / Not responding switch.
  function section(key, title, chip, device) {
    const body = el('div', { class: 'body' });
    const badge = el('span', { class: 'badge' }, 'Not responding');
    const details = el('details', { class: 'dev' },
      el('summary', {}, el('b', {}, title), el('span', { class: 'chip' }, chip), device ? badge : null),
      body);
    details.open = loadPref('devtools.open.' + key, key === 'ble');
    details.ontoggle = () => savePref('devtools.open.' + key, details.open);
    if (device) {
      live(() => { badge.hidden = S[device].enabled; });
      body.append(row(null, seg([[true, 'Enabled'], [false, 'Not responding']],
        () => S[device].enabled, (v) => hw.setEnabled(device, v)),
        el('span', { class: 'hint' }, 'Not responding: its hal functions return -EIO')));
    }
    root.append(details);
    return body;
  }

  // ===== Bluetooth =====
  {
    const b = section('ble', 'Bluetooth', 'nRF52840 ↔ iPhone', 'ble');
    const ble = S.ble;
    const isBonded = () => ble.link === 'bonded';
    const needBond = [];   // controls that only work while bonded
    const bonded = (e) => { needBond.push(e); return e; };
    live(() => needBond.forEach((e) => { e.disabled = !isBonded(); }));

    b.append(
      row('Link', seg(BLE_LINKS.map((l) => [l, l[0].toUpperCase() + l.slice(1)]), () => ble.link, hw.setLink)),
      el('div', { class: 'hint' }, text(() => isBonded()
        ? 'Bonded: time, notifications and music go to the watch.'
        : 'Not bonded: notifications wait on the phone and arrive (flagged pre-existing) when you bond.')));

    // Time (CTS)
    const now = new Date();
    const date = el('input', { type: 'date', value: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}` });
    const time = el('input', { type: 'time', step: 1, value: `${pad2(now.getHours())}:${pad2(now.getMinutes())}:00` });
    const zones = [];
    for (let m = -720; m <= 840; m += 15) zones.push([String(m), fmtOffset(m)]);
    const zone = select(zones);
    zone.value = String(-now.getTimezoneOffset());
    function sendCustom() {
      const [y, mo, d] = date.value.split('-').map(Number);
      const [h, mi, s = 0] = time.value.split(':').map(Number);
      if (!y || h === undefined) return;
      hw.sendTime({ year: y, month: mo, day: d, hour: h, minute: mi, second: s, utcOffsetMin: Number(zone.value) });
    }
    b.append(
      sub('Time (CTS)'),
      row(null, bonded(btn('Send phone time now', () => hw.sendTime(), 'A network time sync: adjust reason EXTERNAL'))),
      row('Custom', date, time, zone, bonded(btn('Send', sendCustom, 'Set by hand on the phone: adjust reason MANUAL'))),
      hint('A different time zone from the last one sent also sets ZONE_CHANGED.'),
      el('div', { class: 'hint' }, text(() => ble.utcOffsetMin === null ? 'No time sent yet.'
        : `Last time zone sent: ${fmtOffset(ble.utcOffsetMin)}`)));

    // Notifications (ANCS)
    const preset = select(Object.keys(NOTIF_PRESETS).map((k) => [k, k]), null, (k) => fill(NOTIF_PRESETS[k]));
    const title = el('input', { type: 'text', class: 'wide' });
    const message = el('input', { type: 'text', class: 'wide' });
    const silent = el('input', { type: 'checkbox' });
    const important = el('input', { type: 'checkbox' });
    const counter = (input) => {
      const span = el('span', { class: 'unit' });
      const update = () => {
        const n = utf8Bytes(input.value);
        span.textContent = `${n}/${BLE_TEXT_MAX}`;
        span.classList.toggle('warn', n > BLE_TEXT_MAX);
        span.title = n > BLE_TEXT_MAX ? 'Longer than BLE_TEXT_MAX bytes: the watch gets it cut short' : '';
      };
      input.addEventListener('input', update);
      updaters.push(update);
      return span;
    };
    function fill(p) {
      title.value = p.title;
      message.value = p.message;
      refresh();
    }
    fill(NOTIF_PRESETS.Messages);
    const notifFromForm = (extra = {}) => {
      const p = NOTIF_PRESETS[preset.value];
      return { app: p.app, category: p.category, title: title.value, message: message.value,
               flags: (silent.checked ? BLE_FLAG.SILENT : 0) | (important.checked ? BLE_FLAG.IMPORTANT : 0), ...extra };
    };
    function burst() {
      for (let i = 1; i <= 10; i++) hw.addNotif(notifFromForm({ title: `${title.value} ${i}/10` }));
    }

    const list = el('div', { class: 'list' });
    let listKey = '';
    live(() => {
      const shown = ble.notifs.filter((n) => n.category !== BLE_CATEGORY.INCOMING_CALL);
      const key = shown.map((n) => n.id).join(',');
      if (key === listKey) return;
      listKey = key;
      list.replaceChildren(...(shown.length ? shown.map((n) => el('div', { class: 'item' },
        el('span', { class: 'id' }, '#' + n.id),
        el('span', { class: 'grow', title: `${n.app}\n${CATEGORY_NAMES[n.category]}` },
          el('b', {}, n.title), ' ', n.message),
        btn('Remove', () => hw.removeNotif(n.id), 'The notification is cleared on the phone')))
        : [hint('None on the phone.')]));
    });

    b.append(
      sub('Notifications (ANCS)'),
      row('App', preset, btn('Long text', () => fill(LONG_TEXT), 'Fill in text longer than 32 bytes')),
      row('Title', title, counter(title)),
      row('Message', message, counter(message)),
      row('Flags', el('label', {}, silent, 'Silent'), el('label', {}, important, 'Important')),
      row(null, el('button', { class: 'primary', onclick: () => hw.addNotif(notifFromForm()) }, 'Send'),
        btn('Send burst of 10', burst)),
      el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'On phone'),
        btn('Remove all', () => [...ble.notifs].forEach((n) => n.category !== BLE_CATEGORY.INCOMING_CALL && hw.removeNotif(n.id)))),
      list);

    // Calls (incoming calls are ANCS notifications too)
    const caller = el('input', { type: 'text', value: 'Alex Kim', class: 'wide' });
    const calls = el('div', { class: 'list' });
    let callsKey = '';
    live(() => {
      const ringing = ble.notifs.filter((n) => n.category === BLE_CATEGORY.INCOMING_CALL);
      const key = ringing.map((n) => n.id).join(',') + '|' + ble.activeCall;
      if (key === callsKey) return;
      callsKey = key;
      calls.replaceChildren(
        ...ringing.map((n) => el('div', { class: 'item' },
          el('span', { class: 'id' }, '#' + n.id),
          el('span', { class: 'grow' }, '📞 Ringing: ', el('b', {}, n.title)),
          btn('Call ended', () => hw.endCall(n.id, false), 'The caller hung up'),
          btn('Missed', () => hw.endCall(n.id, true), 'Hung up, and the phone posts a Missed Call notification'))),
        ble.activeCall ? el('div', { class: 'item' },
          el('span', { class: 'grow' }, 'In a call with ', el('b', {}, ble.activeCall), ' (answered on the watch)'),
          btn('Hang up', hw.hangUp)) : null);
    });
    b.append(
      sub('Calls'),
      row('Caller', caller, el('button', { class: 'primary', onclick: () => hw.incomingCall(caller.value) }, 'Incoming call')),
      calls,
      hint('Accept and decline from the watch show in the Action log.'));

    // Music (AMS)
    const m = ble.music;
    const musicText = (field) => {
      const input = el('input', { type: 'text', class: 'wide', onchange: () => hw.setMusic({ [field]: input.value }) });
      live(() => setValue(input, m[field]));
      return input;
    };
    const position = el('input', { type: 'range', min: 0, step: 1000,
                                   onchange: () => hw.setMusic({ positionMs: Number(position.value) }) });
    live(() => {
      position.max = m.durationMs;
      setValue(position, hw.musicSnapshot().elapsedMs);
    });
    const duration = el('input', { type: 'number', min: 0, step: 1, class: 'num',
                                   onchange: () => hw.setMusic({ durationMs: Number(duration.value) * 1000 }) });
    live(() => setValue(duration, Math.round(m.durationMs / 1000)));
    b.append(
      sub('Music (AMS)'),
      row(null, btn('Load sample track', () => hw.skipTrack(1)),
        btn('⏮', () => hw.skipTrack(-1), 'Previous track on the phone'),
        btn('⏭', () => hw.skipTrack(1), 'Next track on the phone')),
      row('Title', musicText('title')),
      row('Artist', musicText('artist')),
      row('Album', musicText('album')),
      row('Player', seg([[MUSIC_STATE.PAUSED, 'Paused'], [MUSIC_STATE.PLAYING, 'Playing']], () => m.state,
        (v) => hw.setMusic({ state: v }))),
      row('Position', position, text(() => `${fmtMinSec(hw.musicSnapshot().elapsedMs)} / ${fmtMinSec(m.durationMs)}`, 'unit')),
      row('Length', duration, el('span', { class: 'unit' }, 's')),
      slider('Volume', { min: 0, max: 100, step: 1, unit: '%' }, () => Math.round(m.volume), (v) => hw.setMusic({ volume: v })),
      hint('Changes reach the watch when you leave a field. Commands from the watch show in the Action log and change this player.'));
  }

  // ===== Fuel gauge =====
  {
    const b = section('fuel_gauge', 'Fuel gauge', 'MAX17048 · I²C 0x36', 'fuel_gauge');
    const fg = S.fuel_gauge, sim = fg.sim;
    const num = (field, title) => {
      const input = el('input', { type: 'number', min: 1, class: 'num', title,
                                  onchange: () => hw.setBatterySim({ [field]: Math.max(1, Number(input.value) || 1) }) });
      live(() => setValue(input, sim[field]));
      return input;
    };
    const runBtn = el('button', { class: 'primary', onclick: () => hw.runBattery(!sim.running) });
    live(() => { runBtn.textContent = sim.running ? 'Stop' : 'Run'; });

    // What the simulation is doing now, and how long until empty or full
    function simStatus() {
      const ch = S.charger;
      const left = (pct, ma) => pct / 100 * sim.capacityMah / ma;
      let what, hours;
      if (ch.usb && ch.mode === 'charging') { what = `Charging at ${sim.chargeMa} mA`; hours = left(100 - fg.percent, sim.chargeMa); }
      else if (ch.usb) { return `USB in, charger not charging (${CHARGER_STATES[ch.mode].label}): level holds`; }
      else { what = `Discharging at ${sim.loadMa} mA`; hours = left(fg.percent, sim.loadMa); }
      const to = what.startsWith('Charging') ? 'full' : 'empty';
      return `${what}: ${fmtHours(hours)} to ${to}` + (sim.speed > 1 ? ` (${fmtHours(hours / sim.speed)} at ${sim.speed}×)` : '');
    }

    b.append(
      slider('Percent', { min: 0, max: 100, step: 0.1, unit: '%' }, () => fg.percent, (v) => hw.setBattery({ percent: v })),
      slider('Voltage', { min: 3000, max: 4300, step: 1, unit: 'mV' }, () => Math.round(fg.mv), (v) => hw.setBattery({ mv: v })),
      row(null, check('Follow the LiPo curve', () => fg.linked, (v) => { hw.set('fuel_gauge', { linked: v }); hw.setBattery({ percent: fg.percent }); },
        'Moving one slider moves the other along a typical LiPo curve (3.96 V reads as about 72 %)')),
      sub('Battery simulation'),
      row('Cell', num('capacityMah', 'Capacity'), el('span', { class: 'unit' }, 'mAh')),
      row('Load', num('loadMa', 'Current the watch draws from the battery'), el('span', { class: 'unit' }, 'mA'),
        el('span', { class: 'lbl' }, 'Charge'), num('chargeMa', 'Charge current (the BQ25185 ISET resistor sets it)'), el('span', { class: 'unit' }, 'mA')),
      row('Speed', select([1, 10, 60, 600, 3600].map((v) => [String(v), v + '×']), () => String(sim.speed),
        (v) => hw.setBatterySim({ speed: Number(v) })), runBtn),
      el('div', { class: 'hint' }, text(simStatus)),
      hint('Charges while the charger says Charging, otherwise discharges. The battery runs even when the gauge is Not responding: only the I²C chip is missing.'));
  }

  // ===== Charger =====
  {
    const b = section('charger', 'Charger', 'BQ25185 · STAT1 P1.04 · STAT2 P1.06', 'charger');
    const ch = S.charger;
    const pin = (name, port, get) => text(() => `${name} (${port}): ${get() ? 'HIGH 1' : 'LOW 0'}`, 'pin');
    b.append(
      row('USB', seg([[false, 'Unplugged'], [true, 'Plugged in']], () => ch.usb, hw.setUsb)),
      row('State', select(Object.entries(CHARGER_STATES).map(([k, v]) => [k, v.label]), () => ch.mode, hw.setChargerMode)),
      row('Pins', pin('STAT1', 'P1.04', () => ch.stat1), pin('STAT2', 'P1.06', () => ch.stat2)),
      hint('Plugging in starts a charge; the battery simulation switches to Charge complete at 100 %. ' +
           'No input and Charge complete give the same pins: tell them apart with charger_read_usb_power().'));
  }

  // ===== Accelerometer =====
  {
    const b = section('imu', 'Accelerometer', 'LSM6DSO32 · I²C 0x6A · INT2 P1.09', 'imu');
    const imu = S.imu;
    const axis = (a) => slider(a, { min: -4, max: 4, step: 0.01, unit: 'g' }, () => imu[a], (v) => hw.setAccel({ [a]: v }));
    const walk = el('button', { onclick: () => (imu.motion === 'walking' ? hw.stopMotion() : hw.startWalking()) }, 'Walking');
    live(() => walk.classList.toggle('on', imu.motion === 'walking'));
    b.append(
      axis('x'), axis('y'), axis('z'),
      el('div', { class: 'hint' }, text(() => `|a| = ${Math.hypot(imu.x, imu.y, imu.z).toFixed(2)} g. ` +
        'Axes: x to 3 o\'clock, y to 12 o\'clock, z out of the face (left wrist). Beyond ±4 g the chip saturates.')),
      row('Pose', btn('Flat on table', () => hw.setPose('flat')), btn('Wrist raised', () => hw.setPose('raised')),
        btn('Arm down', () => hw.setPose('down')), walk),
      row('Motion', el('button', { class: 'primary', onclick: hw.raiseWrist,
        title: 'Arm down to looking at the watch in 0.7 s: fires wake as it starts and tilt at the end' }, 'Raise wrist')),
      row('Interrupts', btn('Fire wake', () => hw.imuFire('wake')), btn('Fire tilt', () => hw.imuFire('tilt'))),
      hint('Interrupts wait until imu_get_events() takes them.'));
  }

  // ===== Haptic =====
  const hapticLog = el('div', { class: 'list log' });
  {
    const b = section('haptic', 'Haptic', 'DRV2605L · EN P1.02', 'haptic');
    b.append(
      row(null, check('Mute', () => S.haptic.muted, (v) => hw.set('haptic', { muted: v }), 'No pulse on screen; calls are still logged'),
        btn('Clear log', () => hapticLog.replaceChildren())),
      hapticLog,
      hint('Each buzz pulses the bezel and shows the effect and its approximate length.'));
  }

  // ===== RTC =====
  {
    const b = section('rtc', 'RTC', 'RV-3028 · I²C', 'rtc');
    const r = S.rtc;
    const when = el('input', { type: 'datetime-local', step: 1 });
    const setFromInput = () => {
      const [d, t] = when.value.split('T');
      if (!d || !t) return;
      const [y, mo, day] = d.split('-').map(Number);
      const [h, mi, s = 0] = t.split(':').map(Number);
      hw.rtcSet(Date.UTC(y, mo - 1, day, h, mi, s) / 1000);
    };
    when.value = fmtEpoch(hw.rtcNow()).slice(0, 19).replace(' ', 'T');
    const drift = el('input', { type: 'number', step: 1, class: 'num', onchange: () => hw.rtcDrift(Number(drift.value) || 0) });
    live(() => setValue(drift, r.driftPpm));
    b.append(
      row('Time', text(() => fmtEpoch(hw.rtcNow()), 'mono')),
      el('div', { class: 'hint' }, text(() => {
        const diff = hw.rtcNow() - localEpochNow();
        return `${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(1)} s from this computer's clock`;
      })),
      row('Set', when, btn('Set', setFromInput), btn('Now', () => hw.rtcSet(localEpochNow()))),
      row('Clock', seg([[true, 'Running'], [false, 'Stopped']], () => r.running, hw.rtcRun)),
      row('Drift', drift, el('span', { class: 'unit' }, 'ppm'),
        text(() => `${r.driftPpm >= 0 ? '+' : '−'}${(Math.abs(r.driftPpm) * 86400 / 1e6).toFixed(2)} s a day`, 'unit')),
      hint('Local time with no time zone, like the watch keeps it.'));
  }

  // ===== Touch =====
  {
    const b = section('touch', 'Touch', 'CST820', 'touch');
    const t = hw.touch;
    b.append(
      row('Finger', text(() => (t.down ? `down at x ${t.x}, y ${t.y}` : `up (last x ${t.x}, y ${t.y})`), 'mono')),
      hint('The mouse is your finger. Not responding: touches are ignored.'));
  }

  // ===== Buttons =====
  {
    const b = section('buttons', 'Buttons', 'PB1 P1.10 · PB2 P0.24', 'buttons');
    const bt = S.buttons;
    let pb1Timer = null, pb2Timer = null, pb2Start = 0;
    const countdown = el('span', { class: 'hint' });

    // Pressed while the mouse is held down on it, like a real button
    function hold(name, label, onDown, onUp) {
      const e = el('button', { class: 'hold', title: 'Hold it down: buttons_read() reports pressed until you let go' }, label);
      const up = () => { if (bt[name]) { hw.setButton(name, false); onUp(); } };
      e.addEventListener('pointerdown', (ev) => {
        e.setPointerCapture(ev.pointerId);
        hw.setButton(name, true);
        onDown();
      });
      e.addEventListener('pointerup', up);
      e.addEventListener('pointercancel', up);
      live(() => e.classList.toggle('on', bt[name]));
      return e;
    }

    // What src/main.c's handle_buttons() does: PB1 resets after 50 ms; PB2 held for 3 s enters USB mode
    const pb1 = hold('pb1', 'PB1', () => {
      if (bt.builtin) pb1Timer = setTimeout(() => { if (bt.pb1) sim.reset(); }, 50);
    }, () => clearTimeout(pb1Timer));
    const pb2 = hold('pb2', 'PB2', () => {
      if (!bt.builtin) return;
      pb2Start = Date.now();
      pb2Timer = setInterval(() => {
        const held = Date.now() - pb2Start;
        countdown.textContent = `USB mode in ${3 - Math.floor(held / 1000)}`;
        if (held >= 3000) { clearInterval(pb2Timer); countdown.textContent = ''; sim.usbMode(); }
      }, 50);
    }, () => { clearInterval(pb2Timer); countdown.textContent = ''; });

    b.append(
      row('Press', pb1, pb2, countdown),
      row(null, check('Act like src/main.c', () => bt.builtin, (v) => hw.set('buttons', { builtin: v }),
        'The page does what handle_buttons() in src/main.c does')),
      hint('With it on, PB1 resets the watch and holding PB2 for 3 s enters USB mode. Turn it off once your app/ code reads the buttons and does this itself.'));
  }

  // ===== Later =====
  {
    const b = section('later', 'Heart rate and microphone', 'MAX30102 · mic');
    b.append(hint('Placeholders: these get dev tools when they get hal/ headers.'));
  }

  // ---- Haptic pulse on the watch ----

  const watchEl = document.getElementById('watch');
  const badge = document.getElementById('hapticBadge');
  let buzzTimer = null;

  function describeStep(s) {
    if (s > 0x80) return { text: `pause ${(s - 0x80) * 10} ms`, ms: (s - 0x80) * 10 };
    const e = HAPTIC_EFFECTS[s];
    return e ? { text: `${s} ${e.name}`, ms: e.ms === null ? LONG_BUZZ_MS : e.ms, untilStopped: e.ms === null }
             : { text: `${s} ?`, ms: 0 };
  }

  function onHaptic(h) {
    clearTimeout(buzzTimer);
    if (h.stop) {
      watchEl.classList.remove('buzz');
      badge.hidden = true;
      return;
    }
    const steps = h.steps.map(describeStep);
    const ms = steps.reduce((sum, s) => sum + s.ms, 0);
    const until = steps.some((s) => s.untilStopped);
    badge.textContent = `〰 ${steps.map((s) => s.text).join(' → ')}  ·  ${until ? 'until haptic_stop()' : '≈ ' + ms + ' ms'}`;
    badge.hidden = false;
    watchEl.classList.remove('buzz');
    void watchEl.offsetWidth;   // restart the animation if it's already running
    watchEl.classList.add('buzz');
    buzzTimer = setTimeout(() => {
      watchEl.classList.remove('buzz');
      badge.hidden = true;
    }, Math.max(ms, 120) + 400);   // leave the label up a little longer than the buzz
  }

  // Every haptic call from the firmware, with effect names
  function onAction(device, line, ms) {
    if (device !== 'haptic') return;
    const named = line.replace(/haptic_play_effect\((\d+)\)/, (all, n) =>
      `${all}  [${HAPTIC_EFFECTS[n] ? HAPTIC_EFFECTS[n].name : '?'}]`);
    const item = el('div', { class: 'item' + (/ -> -/.test(line) ? ' err' : '') },
      el('span', { class: 'id' }, (ms / 1000).toFixed(3)), el('span', { class: 'grow' }, named));
    hapticLog.prepend(item);
    while (hapticLog.childElementCount > 30) hapticLog.lastChild.remove();
  }

  // ---- Redrawing ----

  function refresh() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {   // at most once a frame, however often the state changes
      pending = false;
      for (const u of updaters) u();
    });
  }
  setInterval(refresh, 250);   // clocks, music position and simulations move by themselves
  for (const u of updaters) u();

  return { refresh, onHaptic, onAction };
}
