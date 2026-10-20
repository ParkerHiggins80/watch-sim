// The simulated hardware: what each device on the watch currently reports, plus the
// iPhone on the other end of Bluetooth. The C fakes (watch-sim/fakes/) read this
// through Module.hw.get() and Module.hw.call().
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
const MUSIC_STATE = { PAUSED: 0, PLAYING: 1 };
const MUSIC_CMD = ['PLAY', 'PAUSE', 'TOGGLE', 'NEXT', 'PREVIOUS', 'VOLUME_UP', 'VOLUME_DOWN'];
const IMU_EVENT = { wake: 1, tilt: 2 };   // hal/imu.h IMU_EVENT_* bits

// The watch has no time zone: its clocks count local time as if it were UTC
function localEpochNow() {
  const d = new Date();
  return Math.floor(d.getTime() / 1000) - d.getTimezoneOffset() * 60;
}

function defaultState() {
  return {
    imu: { enabled: true, x: 0, y: 0, z: 1 },                     // g; flat, face up
    haptic: { enabled: true, muted: false },
    fuel_gauge: { enabled: false, mv: 3960, percent: 72 },        // not fitted on the current board
    charger: { enabled: true, usb: false, stat1: 1, stat2: 1 },   // pin levels
    rtc: { enabled: false, running: true, driftPpm: 0,            // not fitted on the current board
           epoch: localEpochNow(), anchorMs: Date.now() },
    buttons: { enabled: true, pb1: false, pb2: false },
    touch: { enabled: true },
    ble: {
      enabled: true,
      link: 'advertising',
      nextId: 1,
      notifs: [],   // notifications currently on the phone
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

  const changed = () => hooks.onChange && hooks.onChange();

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

  function phoneTime(date = new Date(), adjustReason = 0, utcOffsetMin = -date.getTimezoneOffset()) {
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(),
             hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds(),
             utcOffsetMin, adjustReason };
  }

  // What an iPhone sends once the link is encrypted: the watch reads the time,
  // subscribes to the music player, and ANCS replays notifications already there.
  function onBonded() {
    queue({ type: BLE_EVENT.TIME, time: phoneTime() });
    queue({ type: BLE_EVENT.MUSIC, music: musicSnapshot() });
    for (const n of state.ble.notifs) {
      queue({ type: BLE_EVENT.NOTIF_ADDED, notif: { ...n, flags: n.flags | BLE_FLAG.PREEXISTING } });
    }
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
      // goes away either way; other notifications go away when dismissed.
      notifAction(id, action) {
        const n = state.ble.notifs.find((x) => x.id === id);
        if (n && (n.category === BLE_CATEGORY.INCOMING_CALL || action === 1)) removeNotif(id);
      },
      // The phone's player obeys the command and reports its new state
      musicCommand(cmd) {
        const m = state.ble.music;
        switch (MUSIC_CMD[cmd]) {
          case 'PLAY': setMusic({ state: MUSIC_STATE.PLAYING }); break;
          case 'PAUSE': setMusic({ state: MUSIC_STATE.PAUSED }); break;
          case 'TOGGLE': setMusic({ state: m.state === MUSIC_STATE.PLAYING ? MUSIC_STATE.PAUSED : MUSIC_STATE.PLAYING }); break;
          case 'NEXT': case 'PREVIOUS': setMusic({ positionMs: 0 }); break;
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

  return {
    state,

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

    imuFire(name) { imuEvents |= IMU_EVENT[name]; },

    rtcSet,
    rtcRun(running) {
      if (running === state.rtc.running) return;
      state.rtc.epoch = rtcNow();
      state.rtc.anchorMs = Date.now();
      state.rtc.running = running;
      changed();
    },

    setLink(name) {
      if (!BLE_LINKS.includes(name) || name === state.ble.link) return;
      state.ble.link = name;
      queue({ type: BLE_EVENT.LINK, link: BLE_LINKS.indexOf(name) });
      if (name === 'bonded') onBonded();
      changed();
    },

    // Phone time now, or a given Date / time zone (minutes from UTC)
    sendTime(date, utcOffsetMin, adjustReason = 1) {
      if (bonded()) queue({ type: BLE_EVENT.TIME, time: phoneTime(date, adjustReason, utcOffsetMin) });
    },

    // { category, app, title, message, flags }; returns the new notification's id
    addNotif(n) {
      const notif = { category: BLE_CATEGORY.OTHER, flags: 0, app: '', title: '', message: '', ...n,
                      id: state.ble.nextId++ };
      if (notif.category === BLE_CATEGORY.INCOMING_CALL) notif.flags |= BLE_FLAG.POSITIVE | BLE_FLAG.NEGATIVE;
      state.ble.notifs.push(notif);
      if (bonded()) queue({ type: BLE_EVENT.NOTIF_ADDED, notif });
      changed();
      return notif.id;
    },
    removeNotif,
    setMusic,
  };
}
