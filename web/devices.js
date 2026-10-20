// The simulated hardware: what each device on the watch currently reports, plus the
// iPhone on the other end of Bluetooth. The C fakes (watch-sim/fakes/) read this
// through Module.hw.get() and Module.hw.call(); the dev tools panel (web/devtools.js)
// changes it through the methods at the bottom.
//
// It lives in the page rather than in the compiled watch, so a recompile or reset
// keeps it (the battery stays at the level you set). Everything in `state` is plain
// data, so it can later be saved and loaded as a scenario.
'use strict';

// Must match the enums in the firmware's hal/ble.h
const BLE_LINKS = ['disconnected', 'advertising', 'connected', 'bonded'];
const BLE_EVENT = { LINK: 0, TIME: 1, NOTIF_ADDED: 2, NOTIF_REMOVED: 3, MUSIC: 4 };
const BLE_CATEGORY = { OTHER: 0, INCOMING_CALL: 1, MISSED_CALL: 2, VOICEMAIL: 3, SOCIAL: 4,
  SCHEDULE: 5, EMAIL: 6, NEWS: 7, HEALTH_AND_FITNESS: 8, BUSINESS_AND_FINANCE: 9,
  LOCATION: 10, ENTERTAINMENT: 11 };
const BLE_FLAG = { SILENT: 1, IMPORTANT: 2, PREEXISTING: 4, POSITIVE: 8, NEGATIVE: 16 };
const BLE_TIME = { MANUAL: 1, EXTERNAL: 2, ZONE_CHANGED: 4, DST_CHANGED: 8 };
const MUSIC_STATE = { PAUSED: 0, PLAYING: 1 };
const MUSIC_CMD = ['PLAY', 'PAUSE', 'TOGGLE', 'NEXT', 'PREVIOUS', 'VOLUME_UP', 'VOLUME_DOWN'];
const IMU_EVENT = { wake: 1, tilt: 2 };   // hal/imu.h IMU_EVENT_* bits

// What the phone's player skips through on NEXT / PREVIOUS
const SAMPLE_TRACKS = [
  { title: 'Morning Run', artist: 'The Placeholders', album: 'Test Signals', durationMs: 214000 },
  { title: 'Low Battery Blues', artist: 'Lithium Polymer', album: 'Charge Cycles', durationMs: 187000 },
  { title: 'A Very Long Song Title That Will Not Fit On The Watch', artist: 'Truncation Orchestra',
    album: 'Thirty-Two Bytes Is Not Very Much', durationMs: 305000 },
];

// BQ25185 status pins (datasheet SLUSF65, "Charging state" table). They are open drain,
// so "high" is the pull-up. No input and charge complete read the same; the firmware
// tells them apart with USB power.
const CHARGER_STATES = {
  no_input:      { label: 'No input (sleep)', stat1: 1, stat2: 1 },
  charging:      { label: 'Charging',         stat1: 1, stat2: 0 },
  done:          { label: 'Charge complete',  stat1: 1, stat2: 1 },
  fault:         { label: 'Fault (recoverable: OVP, TS, TSHUT)', stat1: 0, stat2: 1 },
  fault_latched: { label: 'Fault (latched: ISET short, BATOCP, safety timer)', stat1: 0, stat2: 0 },
};

// Open-circuit voltage of a small LiPo cell against state of charge (typical curve,
// tuned so 72 % is about 3.96 V like the real watch). [percent, mV]
const LIPO_CURVE = [
  [0, 3300], [3, 3500], [6, 3600], [10, 3650], [15, 3690], [20, 3710], [25, 3730],
  [30, 3750], [35, 3770], [40, 3790], [45, 3800], [50, 3820], [55, 3840], [60, 3870],
  [65, 3910], [70, 3950], [75, 3980], [80, 4020], [85, 4080], [90, 4110], [95, 4150], [100, 4200],
];
const CELL_RESISTANCE_OHM = 0.2;   // internal resistance: voltage sags under load, rises on charge

function curveMv(percent) {
  const p = Math.max(0, Math.min(100, percent));
  for (let i = 1; i < LIPO_CURVE.length; i++) {
    const [p1, v1] = LIPO_CURVE[i];
    if (p <= p1) {
      const [p0, v0] = LIPO_CURVE[i - 1];
      return v0 + (v1 - v0) * (p - p0) / (p1 - p0);
    }
  }
  return 4200;
}

function curvePercent(mv) {
  if (mv <= LIPO_CURVE[0][1]) return 0;
  for (let i = 1; i < LIPO_CURVE.length; i++) {
    const [p1, v1] = LIPO_CURVE[i];
    if (mv <= v1) {
      const [p0, v0] = LIPO_CURVE[i - 1];
      return p0 + (p1 - p0) * (mv - v0) / (v1 - v0);
    }
  }
  return 100;
}

// Accelerometer poses in g. Axes as on most watches: x towards 3 o'clock (the hand),
// y towards 12 o'clock, z out of the face. Worn on the left wrist.
const IMU_POSES = {
  flat:   { x: 0, y: 0, z: 1 },          // on a table, face up
  raised: { x: 0, y: 0.5, z: 0.866 },    // looking at it: forearm level, face tipped 30° towards you
  down:   { x: -1, y: 0, z: 0 },         // arm hanging at your side, hand pointing down
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Copies src into target, going into nested objects so references to them (the dev
// tools hold some) stay valid. Arrays and plain values are replaced.
function assignDeep(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (isObject(v) && isObject(target[k])) assignDeep(target[k], v);
    else target[k] = isObject(v) || Array.isArray(v) ? JSON.parse(JSON.stringify(v)) : v;
  }
  return target;
}

// The watch has no time zone: its clocks count local time as if it were UTC
function localEpochNow() {
  const d = new Date();
  return Math.floor(d.getTime() / 1000) - d.getTimezoneOffset() * 60;
}

function defaultState() {
  return {
    imu: { enabled: true, ...IMU_POSES.flat, motion: 'still' },   // or 'walking', 'raising'
    haptic: { enabled: true, muted: false },
    fuel_gauge: { enabled: false, mv: 3960, percent: 72,          // not fitted on the current board
                  linked: true,                                   // sliders follow the LiPo curve
                  sim: { running: false, capacityMah: 500, loadMa: 20, chargeMa: 100, speed: 60 } },
    charger: { enabled: true, usb: false, mode: 'no_input', stat1: 1, stat2: 1 },
    rtc: { enabled: false, running: true, driftPpm: 0,            // not fitted on the current board
           epoch: localEpochNow(), anchorMs: Date.now() },
    buttons: { enabled: true, pb1: false, pb2: false,
               builtin: true },   // the page resets / enters USB mode like src/main.c does
    touch: { enabled: true },
    ble: {
      enabled: true,
      link: 'advertising',
      nextId: 1,
      notifs: [],                 // notifications currently on the phone
      utcOffsetMin: null,         // time zone in the last time the phone sent
      activeCall: null,           // caller of a call answered on the watch
      music: { title: '', artist: '', album: '', state: MUSIC_STATE.PAUSED,
               positionMs: 0, positionAt: Date.now(), durationMs: 0, volume: 50 },
    },
  };
}

// hooks: { onHaptic(info), onChange() } — the page uses these to show what happened
function createHardware(hooks = {}) {
  const state = defaultState();

  // Things that are lost when the watch resets: pending interrupts and queued events
  let imuEvents = 0;
  let bleQueue = [];
  let bleEvent = null;   // the event ble_poll() is reading
  let sequence = null;

  // Live touch, shown in the dev tools; not part of the saved state
  const touch = { x: 0, y: 0, down: false };

  const changed = () => hooks.onChange && hooks.onChange();

  // ---- Accelerometer motion: walking and the raise-wrist animation ----

  let motionTimer = null;

  function stopMotion() {
    clearInterval(motionTimer);
    motionTimer = null;
    state.imu.motion = 'still';
  }

  function setAccel(v) {
    stopMotion();
    Object.assign(state.imu, v);
    changed();
  }

  // Arm hanging down and swinging at about 0.9 Hz (one swing per two steps), a jolt
  // through the arm at each footstep, and sensor noise on top
  function startWalking() {
    stopMotion();
    state.imu.motion = 'walking';
    const t0 = Date.now();
    const noise = () => (Math.random() - 0.5) * 0.06;
    motionTimer = setInterval(() => {
      const t = (Date.now() - t0) / 1000;
      const swing = 0.4 * Math.sin(2 * Math.PI * 0.9 * t);
      const step = 0.35 * Math.max(0, Math.sin(2 * Math.PI * 1.8 * t)) ** 6;
      state.imu.x = -Math.cos(swing) - step + noise();
      state.imu.y = Math.sin(swing) + noise();
      state.imu.z = 0.1 * Math.sin(2 * Math.PI * 1.8 * t) + noise();
      changed();
    }, 20);
    changed();
  }

  // Arm down to looking at the watch in 0.7 s. The wake interrupt fires as it starts
  // moving and the tilt interrupt at the end, as the LSM6DSO32 would with both enabled.
  function raiseWrist() {
    stopMotion();
    state.imu.motion = 'raising';
    const from = IMU_POSES.down, to = IMU_POSES.raised, t0 = Date.now(), ms = 700;
    imuEvents |= IMU_EVENT.wake;
    motionTimer = setInterval(() => {
      const f = Math.min(1, (Date.now() - t0) / ms);
      const e = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;    // ease in and out
      const push = 0.3 * Math.sin(Math.PI * f);                      // the arm accelerating up
      state.imu.x = from.x + (to.x - from.x) * e;
      state.imu.y = from.y + (to.y - from.y) * e;
      state.imu.z = from.z + (to.z - from.z) * e + push;
      if (f >= 1) {
        stopMotion();
        Object.assign(state.imu, to);
        imuEvents |= IMU_EVENT.tilt;
      }
      changed();
    }, 20);
    changed();
  }

  // ---- Battery: fuel gauge and charger ----

  function setChargerMode(mode) {
    if (!CHARGER_STATES[mode]) return;
    state.charger.mode = mode;
    state.charger.stat1 = CHARGER_STATES[mode].stat1;
    state.charger.stat2 = CHARGER_STATES[mode].stat2;
    changed();
  }

  // Plugging in starts a charge (or reports done if full); unplugging puts it to sleep
  function setUsb(present) {
    state.charger.usb = present;
    setChargerMode(!present ? 'no_input' : state.fuel_gauge.percent >= 99.5 ? 'done' : 'charging');
  }

  function setBattery({ percent, mv }) {
    const fg = state.fuel_gauge;
    if (percent !== undefined) {
      fg.percent = Math.max(0, Math.min(100, percent));
      if (fg.linked) fg.mv = curveMv(fg.percent);
    }
    if (mv !== undefined) {
      fg.mv = mv;
      if (fg.linked) fg.percent = curvePercent(mv);
    }
    changed();
  }

  // The battery simulation: charges at chargeMa while the charger says charging, otherwise
  // discharges at loadMa (with USB in, the charger's power path runs the watch instead).
  // speed makes simulated time run faster than real time.
  let batteryTimer = null;
  const BATTERY_TICK_MS = 200;

  function batteryTick() {
    const fg = state.fuel_gauge, sim = fg.sim, ch = state.charger;
    const hours = BATTERY_TICK_MS / 3600e3 * sim.speed;
    let ma = 0;
    if (ch.usb && ch.mode === 'charging') ma = sim.chargeMa;
    else if (!ch.usb) ma = -sim.loadMa;

    fg.percent = Math.max(0, Math.min(100, fg.percent + ma * hours / sim.capacityMah * 100));
    fg.mv = Math.min(4200, curveMv(fg.percent) + ma * CELL_RESISTANCE_OHM);
    if (ma > 0 && fg.percent >= 100) setChargerMode('done');
    if (ma < 0 && fg.percent <= 0) runBattery(false);   // flat
    changed();
  }

  function runBattery(running) {
    clearInterval(batteryTimer);
    batteryTimer = running ? setInterval(batteryTick, BATTERY_TICK_MS) : null;
    state.fuel_gauge.sim.running = running;
    changed();
  }

  // ---- RTC ----

  function rtcNow() {
    const r = state.rtc;
    if (!r.running) return r.epoch;
    return r.epoch + (Date.now() - r.anchorMs) / 1000 * (1 + r.driftPpm / 1e6);
  }
  function rtcSet(epoch) {
    state.rtc.epoch = epoch;
    state.rtc.anchorMs = Date.now();
    changed();
  }

  // ---- Bluetooth: the phone side ----

  const bonded = () => state.ble.link === 'bonded';

  function queue(evt) {
    bleQueue.push(evt);
  }

  function musicSnapshot() {
    const m = state.ble.music;
    let pos = m.positionMs;
    if (m.state === MUSIC_STATE.PLAYING) pos += Date.now() - m.positionAt;
    return { title: m.title, artist: m.artist, album: m.album, state: m.state,
             elapsedMs: Math.min(pos, m.durationMs || pos), durationMs: m.durationMs, volume: m.volume };
  }

  // Wall-clock fields of a Date in the browser's time zone
  function phoneTime(date = new Date()) {
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(),
             hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds(),
             utcOffsetMin: -date.getTimezoneOffset() };
  }

  // CTS: the phone sends its local time. A different time zone from last time sets
  // the ZONE_CHANGED bit, as iOS does.
  function queueTime(t, reason) {
    const b = state.ble;
    if (b.utcOffsetMin !== null && t.utcOffsetMin !== b.utcOffsetMin) reason |= BLE_TIME.ZONE_CHANGED;
    b.utcOffsetMin = t.utcOffsetMin;
    queue({ type: BLE_EVENT.TIME, time: { ...t, adjustReason: reason } });
  }

  // What an iPhone sends once the link is encrypted: the watch reads the time,
  // subscribes to the music player, and ANCS replays notifications already there.
  function onBonded() {
    queueTime(phoneTime(), 0);
    queue({ type: BLE_EVENT.MUSIC, music: musicSnapshot() });
    for (const n of state.ble.notifs) {
      queue({ type: BLE_EVENT.NOTIF_ADDED, notif: { ...n, flags: n.flags | BLE_FLAG.PREEXISTING } });
    }
  }

  function addNotif(n) {
    const notif = { category: BLE_CATEGORY.OTHER, flags: 0, app: '', title: '', message: '', ...n,
                    id: state.ble.nextId++ };
    if (notif.category === BLE_CATEGORY.INCOMING_CALL) notif.flags |= BLE_FLAG.POSITIVE | BLE_FLAG.NEGATIVE;
    state.ble.notifs.push(notif);
    if (bonded()) queue({ type: BLE_EVENT.NOTIF_ADDED, notif });
    changed();
    return notif.id;
  }

  function removeNotif(id) {
    const i = state.ble.notifs.findIndex((n) => n.id === id);
    if (i < 0) return false;
    state.ble.notifs.splice(i, 1);
    if (bonded()) queue({ type: BLE_EVENT.NOTIF_REMOVED, notif: { id } });
    changed();
    return true;
  }

  function setMusic(changes) {
    const m = state.ble.music;
    const snap = musicSnapshot();
    m.positionMs = 'positionMs' in changes ? changes.positionMs : snap.elapsedMs;
    m.positionAt = Date.now();
    Object.assign(m, changes);
    m.volume = Math.max(0, Math.min(100, m.volume));
    if (bonded()) queue({ type: BLE_EVENT.MUSIC, music: musicSnapshot() });
    changed();
  }

  // NEXT / PREVIOUS move through SAMPLE_TRACKS. Like iOS, PREVIOUS more than 3 s into
  // a track restarts it instead.
  function skipTrack(dir) {
    const m = state.ble.music;
    if (dir < 0 && musicSnapshot().elapsedMs > 3000) return setMusic({ positionMs: 0 });
    const i = SAMPLE_TRACKS.findIndex((t) => t.title === m.title);
    const n = SAMPLE_TRACKS.length;
    const next = i < 0 ? 0 : (i + dir + n) % n;
    setMusic({ ...SAMPLE_TRACKS[next], positionMs: 0 });
  }

  // Methods the C fakes call through fake_call()
  const methods = {
    imu: {
      takeEvents() { const e = imuEvents; imuEvents = 0; return e; },
    },
    haptic: {
      play(effect) { if (!state.haptic.muted && hooks.onHaptic) hooks.onHaptic({ steps: [effect] }); },
      sequenceStart() { sequence = []; },
      sequenceStep(step) { sequence.push(step); },
      sequenceEnd() { if (!state.haptic.muted && hooks.onHaptic) hooks.onHaptic({ steps: sequence }); },
      stop() { if (hooks.onHaptic) hooks.onHaptic({ stop: true }); },
    },
    rtc: {
      set: rtcSet,
    },
    ble: {
      next() {
        bleEvent = bleQueue.shift() || null;
        return bleEvent ? 1 : 0;
      },
      linkCode() { return BLE_LINKS.indexOf(state.ble.link); },
      // What the phone does when the watch accepts or declines: a call notification
      // goes away either way (accepting starts the call); other notifications go away
      // when dismissed.
      notifAction(id, action) {
        const n = state.ble.notifs.find((x) => x.id === id);
        if (!n) return;
        if (n.category === BLE_CATEGORY.INCOMING_CALL) {
          if (action === 0) state.ble.activeCall = n.title;
          removeNotif(id);
        } else if (action === 1) {
          removeNotif(id);
        }
      },
      // The phone's player obeys the command and reports its new state
      musicCommand(cmd) {
        const m = state.ble.music;
        switch (MUSIC_CMD[cmd]) {
          case 'PLAY': setMusic({ state: MUSIC_STATE.PLAYING }); break;
          case 'PAUSE': setMusic({ state: MUSIC_STATE.PAUSED }); break;
          case 'TOGGLE': setMusic({ state: m.state === MUSIC_STATE.PLAYING ? MUSIC_STATE.PAUSED : MUSIC_STATE.PLAYING }); break;
          case 'NEXT': skipTrack(1); break;
          case 'PREVIOUS': skipTrack(-1); break;
          case 'VOLUME_UP': setMusic({ volume: m.volume + 6.25 }); break;    // iOS has 16 volume steps
          case 'VOLUME_DOWN': setMusic({ volume: m.volume - 6.25 }); break;
        }
      },
    },
  };

  // Values computed when read
  const computed = {
    rtc: { now: rtcNow },
  };

  function lookup(obj, path) {
    for (const key of path.split('.')) {
      if (obj == null) return undefined;
      obj = obj[key];
    }
    return obj;
  }

  // ---- Scenarios: the whole state as plain JSON ----

  // Clocks are saved relative to now (the RTC as seconds ahead of or behind this
  // computer, the music as a position), so a scenario means the same thing whenever
  // it's loaded.
  function snapshot() {
    const s = JSON.parse(JSON.stringify(state));
    const r = state.rtc;
    s.rtc = { enabled: r.enabled, running: r.running, driftPpm: r.driftPpm,
              offsetS: Math.round((rtcNow() - localEpochNow()) * 10) / 10,   // used while running
              epoch: Math.floor(rtcNow()) };                                 // used while stopped
    s.ble.music.positionMs = musicSnapshot().elapsedMs;
    delete s.ble.music.positionAt;
    if (s.imu.motion === 'raising') s.imu.motion = 'still';
    s.buttons.pb1 = s.buttons.pb2 = false;
    return s;
  }

  // Replaces the whole state. Anything the saved state leaves out gets its default, so
  // scenarios saved by an older simulator still load.
  // live: the watch keeps running and hears about the change, as it would if the phone
  // changed. Otherwise the page restarts the watch afterwards, which sends everything anyway.
  function load(saved, { live = false } = {}) {
    const old = { link: state.ble.link, notifs: state.ble.notifs.map((n) => n.id) };
    stopMotion();
    clearInterval(batteryTimer);
    batteryTimer = null;

    const next = assignDeep(defaultState(), saved);
    const r = next.rtc;
    r.epoch = r.running && typeof r.offsetS === 'number' ? localEpochNow() + r.offsetS : r.epoch;
    r.anchorMs = Date.now();
    delete r.offsetS;
    next.ble.music.positionAt = Date.now();
    next.buttons.pb1 = next.buttons.pb2 = false;
    const pins = CHARGER_STATES[next.charger.mode] || CHARGER_STATES.no_input;
    next.charger.stat1 = pins.stat1;
    next.charger.stat2 = pins.stat2;
    for (const k of Object.keys(state)) if (!(k in next)) delete state[k];
    assignDeep(state, next);

    if (state.imu.motion === 'walking') startWalking();
    else state.imu.motion = 'still';
    if (state.fuel_gauge.sim.running) runBattery(true);

    if (live) {
      if (state.ble.link !== old.link) {
        queue({ type: BLE_EVENT.LINK, link: BLE_LINKS.indexOf(state.ble.link) });
        if (bonded()) onBonded();
      } else if (bonded()) {
        // Same link: the phone clears what it had and posts what the scenario has
        for (const id of old.notifs) queue({ type: BLE_EVENT.NOTIF_REMOVED, notif: { id } });
        for (const notif of state.ble.notifs) queue({ type: BLE_EVENT.NOTIF_ADDED, notif });
        queue({ type: BLE_EVENT.MUSIC, music: musicSnapshot() });
      }
    }
    changed();
  }

  return {
    state,
    touch,
    snapshot,
    load,

    // ---- Used by the C fakes ----
    get(device, path) {
      const c = computed[device] && computed[device][path];
      if (c) return c();
      if (device === 'ble' && path.startsWith('event.')) return lookup(bleEvent, path.slice(6));
      return lookup(state[device], path);
    },
    call(device, method, a, b) {
      return methods[device][method](a, b);
    },

    // ---- Used by the page (dev tools) ----

    // The watch restarted: pending interrupts and events are gone. If the phone was
    // bonded it reconnects straight away and sends everything again.
    reset() {
      imuEvents = 0;
      bleQueue = [];
      bleEvent = null;
      if (bonded()) onBonded();
    },

    // Enabled / Not responding
    setEnabled(device, enabled) {
      state[device].enabled = enabled;
      changed();
    },
    // Any other plain setting, like haptic.muted or rtc.driftPpm
    set(device, changes) {
      Object.assign(state[device], changes);
      changed();
    },

    setAccel,
    setPose(name) { setAccel(IMU_POSES[name]); },
    startWalking,
    stopMotion() { stopMotion(); changed(); },
    raiseWrist,
    imuFire(name) { imuEvents |= IMU_EVENT[name]; },

    setBattery,
    setBatterySim(changes) { Object.assign(state.fuel_gauge.sim, changes); changed(); },
    runBattery,
    setUsb,
    setChargerMode,

    rtcNow,
    rtcSet,
    rtcRun(running) {
      if (running === state.rtc.running) return;
      state.rtc.epoch = rtcNow();
      state.rtc.anchorMs = Date.now();
      state.rtc.running = running;
      changed();
    },
    rtcDrift(ppm) {
      state.rtc.epoch = rtcNow();   // the drift so far stays; the new rate applies from now
      state.rtc.anchorMs = Date.now();
      state.rtc.driftPpm = ppm;
      changed();
    },

    setButton(name, pressed) {
      state.buttons[name] = pressed;
      changed();
    },

    setLink(name) {
      if (!BLE_LINKS.includes(name) || name === state.ble.link) return;
      state.ble.link = name;
      queue({ type: BLE_EVENT.LINK, link: BLE_LINKS.indexOf(name) });
      if (name === 'bonded') onBonded();
      changed();
    },

    // CTS. Without arguments: the phone's time now, as after a network time sync.
    // t: { year, month, day, hour, minute, second, utcOffsetMin }, as set by hand.
    sendTime(t) {
      if (!bonded()) return false;
      if (t) queueTime(t, BLE_TIME.MANUAL);
      else queueTime(phoneTime(), BLE_TIME.EXTERNAL);
      changed();
      return true;
    },

    // { category, app, title, message, flags }; returns the new notification's id
    addNotif,
    removeNotif,

    incomingCall(caller) {
      return addNotif({ category: BLE_CATEGORY.INCOMING_CALL, app: 'com.apple.mobilephone',
                        title: caller, message: 'Incoming Call' });
    },
    // The caller hung up. missed: the phone also posts a Missed Call notification.
    endCall(id, missed) {
      const n = state.ble.notifs.find((x) => x.id === id);
      if (!n) return;
      removeNotif(id);
      if (missed) {
        addNotif({ category: BLE_CATEGORY.MISSED_CALL, app: 'com.apple.mobilephone',
                   title: n.title, message: 'Missed Call' });
      }
    },
    hangUp() {
      state.ble.activeCall = null;
      changed();
    },

    setMusic,
    skipTrack,
    musicSnapshot,
  };
}
