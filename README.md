# watch-sim

A browser simulator for the Smartwatch firmware. It compiles the firmware's portable code
(`ui/`, later `app/`) together with LVGL 8.3 to WebAssembly and draws it on a 466x466 canvas.
See [SPEC.md](SPEC.md) for the full plan.

## Status

Stage 6 of 7: the dev tools panel, with every device on the watch.

## Codespace

Create a Codespace from this repo (Code > Codespaces > Create). GitHub will ask you to
approve access to the repos in `repos.json` (push code and open pull requests); accept, so you
can push and open PRs from the Codespace.
On creation it:

1. Builds the container from `.devcontainer/Dockerfile` (Emscripten 6.0.12, CMake, Python,
   Claude Code). Claude Code updates itself; run `claude` and log in once per Codespace.
2. Runs `tools/codespace-setup.sh`: clones every repo in `repos.json` next to watch-sim,
   fetches LVGL, links `watch-sim/vscode/` to `/workspaces/.vscode`, and does a first build.
3. Runs `tools/start-server.sh` each time VS Code attaches (postAttachCommand), which serves `dist/` on port 8080.
   Codespaces notices the port and opens the simulator in a Simple Browser pane.
   Drag that tab next to your code.

VS Code opens `/workspaces`, so both repos are in the file tree and in Source Control.

The CMake Tools extension is kept out (`"-ms-vscode.cmake-tools"` in `devcontainer.json`). It
would find Smartwatch's Zephyr `CMakeLists.txt`, which only builds with nRF Connect SDK, and keep
asking which CMakeLists.txt to use. The simulator builds with Ctrl+Shift+B instead.

If the pane is closed: Ports tab > port 8080 > "Preview in Editor" (the globe icon opens it
in a browser tab instead). After a rebuild, reload the pane.

### Adding a firmware repo

Add it to `repos.json`, then run `tools/repos.py sync-devcontainer` to request access
for it in `devcontainer.json`. Commit both and rebuild the Codespace (Ctrl+Shift+P >
"Codespaces: Rebuild Container"). Setup warns if the two files disagree.

## Compiling

Three ways, all the same build (`build/compile.py`, which runs `build/build.sh`):

- **Compile button** in the simulator panel. The dropdown next to it picks which cloned repo
  from `repos.json` to build; changing it builds straight away.
- **Ctrl+Shift+B** in VS Code (the "Compile watch simulator" task in `vscode/tasks.json`).
  Errors and warnings go to the Problems panel; click one to jump to the line. It builds the
  repo picked in the panel's dropdown.
- **Auto compile on save**, a checkbox in the panel, off by default. Saving any `.c`/`.h` in
  `ui/`, `app/` or `hal/`, or `prj.conf`, starts a build.

When a build finishes the panel restarts the watch with the new code, without reloading the
page. When it fails, the errors cover the screen (with the full compiler output underneath) and
the last good build keeps running behind them. Only one build runs at a time; a request made
during a build runs once it's done.

Switching to a different repo recompiles LVGL (about a minute), because each repo's
`prj.conf` can set different LVGL options.

## The display

- **Round mask**: the canvas is clipped to a circle like the real glass, so anything you draw in
  the corners is cut off, the same as on the watch.
- **Zoom** (the dropdown under the toolbar): *Fit to pane* fills the space available; *1:1 pixels*
  maps one panel pixel to one screen pixel; *Real size* shows the panel at its physical size.
  The size comes from `diameterMm` in `web/config.js` (36.32 mm, 1.43"; set it from your panel's
  datasheet). Browsers don't know how big a millimetre is on your screen, so press
  **Calibrate…**, hold a credit card to the screen and size the rectangle to match. Calibration,
  zoom and throttle are remembered per browser.
- **Touch**: the mouse is your finger. Press, drag and hold work as on the watch (LVGL turns them
  into clicks, scrolls and long presses). Presses outside the circle are ignored and dragging
  off the edge lifts the finger, because the touch panel is round too.
- **Throttle to real frame time**: on the watch, sending pixels to the panel is a blocking SPI
  write (32 MHz), and a full screen takes about 116 ms (`fullFrameMs` in `web/config.js`). With
  the throttle on, every redraw blocks the main loop for its share of that: a full-screen
  redraw takes 116 ms, a small label a few ms. Animations then stutter where they would on
  the watch. Rendering time on the nRF52840 is not included, so the real watch can be a bit slower.

Touch here is wired straight into LVGL by `sim/main.c`. On the watch, the CST820 touch controller
needs its own LVGL input device in your firmware.

## Firmware layout: ui/, app/, hal/

The simulator compiles the firmware's `ui/` and `app/` folders. Neither may use Zephyr, so the
hardware sits behind the headers in `hal/`:

| Header | Device | In the simulator |
|---|---|---|
| `hal/time.h` | uptime in ms | time since the simulated watch started |
| `hal/system.h` | reboot, USB mode | restarts the watch / shows a USB mode screen |
| `hal/buttons.h` | PB1, PB2 | dev tools buttons |
| `hal/imu.h` | LSM6DSO32 | sliders in g; ±4 g full scale and 0.122 mg steps like `src/main.c` |
| `hal/haptic.h` | DRV2605L | an on-screen pulse and the action log |
| `hal/fuel_gauge.h` | MAX17048 | voltage and percent; Not responding by default, like the board |
| `hal/charger.h` | BQ25185 STAT1/STAT2, USB power | pin levels |
| `hal/rtc.h` | RV-3028 | settable clock with drift; Not responding by default, like the board |
| `hal/ble.h` | link, CTS, ANCS, AMS | the dev tools play the iPhone |

Rules the headers follow:

- Every function returns 0 or a negative error code. A device set to Not responding returns
  `-EIO`. Compare against the names (`-EIO`), not numbers: the simulator's C library numbers
  them differently from Zephyr's (`-EIO` is -29 here, -5 on the watch).
- Nothing calls back into your code. Interrupts and Bluetooth arrive as events that `app_tick()`
  takes with `imu_get_events()` and `ble_poll()`, so screens are only touched from the main loop.
- Include them as `"hal/imu.h"`, with the repo root on the include path. Never add `hal/`
  itself, or `hal/time.h` would hide the C library's `<time.h>`.
- Bluetooth text is cut at 32 bytes (`BLE_TEXT_MAX`), because NCS 2.6's ANCS client accepts no
  more per field. The simulator cuts it the same way.

Both mains call `app_init()` once after `ui_init()`, then `app_tick()` every loop before LVGL.
The watch-side implementations of `hal/` (real drivers in `src/`) are yours to write.

Each `hal/x.h` is matched by `fakes/x.c` in this repo. If you change a header, the matching fake
has to change too (the build says so if it doesn't compile). A header with no fake gives a build
warning.

## Dev tools panel

The column to the right of the display (under it when the pane is narrow; the **Dev tools**
checkbox hides it). One section per device; click a title to fold it. Each section has an
**Enabled / Not responding** switch: Not responding makes that device's hal functions return
`-EIO`, so you can test how your code copes with a broken part. The title shows a red
*Not responding* while it's off.

- **Bluetooth** (the dev tools play the iPhone):
  - *Link*: disconnected, advertising, connected, bonded. Time, notifications and music only
    reach the watch while bonded. On bonding the phone sends its time, the music state, and every
    notification already on it, flagged `PREEXISTING`.
  - *Time (CTS)*: send the phone's time now (adjust reason `EXTERNAL`), or a custom date, time
    and time zone (`MANUAL`). A time zone different from the last one sent adds `ZONE_CHANGED`.
  - *Notifications (ANCS)*: presets for Messages, Mail, Instagram and Calendar fill in the app id
    and category; edit the title and message. The byte counters turn yellow past 32 bytes, where
    the watch gets the text cut. *Long text* fills in text that's too long, with an emoji to check a
    cut never splits a character. *Send burst of 10*, and the list of notifications on the phone
    with *Remove*. Anything sent while not bonded waits on the phone and arrives on bonding.
  - *Calls*: an incoming call with a caller name; *Call ended* (the caller hung up) or *Missed*
    (the phone also posts a Missed Call). Accept and decline from the watch show in the action log;
    accepting shows "In a call".
  - *Music (AMS)*: title, artist, album, playing or paused, position, length and volume. A field's
    change is sent when you leave it. *Load sample track* and ⏮ ⏭ go through a few made-up tracks
    (one has names too long for the watch). Commands from the watch change this player.
- **Fuel gauge** (Not responding by default, like the board): percent and voltage sliders that
  follow a typical LiPo curve (72 % is about 3.96 V); untick *Follow the LiPo curve* to set them
  separately. The *battery simulation* discharges a 500 mAh cell at the load current, or charges it
  at the charge current while the charger is charging, sped up by the multiplier. The battery runs
  even with the gauge Not responding, because only the I²C chip is missing.
- **Charger**: USB plugged in, and the BQ25185 state with the STAT1/STAT2 levels your code reads
  (from the datasheet: charging H/L, done or no input H/H, recoverable fault L/H, latched fault L/L).
  Plugging in starts a charge; the simulation switches to *Charge complete* at 100 %.
- **Accelerometer**: x, y, z in g (±4 g, then the chip saturates), presets for flat, wrist
  raised, arm down and walking (arm swing, footsteps and noise). *Raise wrist* moves from arm down to
  looking at the watch in 0.7 s, firing the wake interrupt as it starts and tilt at the end. *Fire
  wake* and *Fire tilt* set the interrupt bits for `imu_get_events()`. The axes assume x to 3 o'clock,
  y to 12 o'clock and z out of the face on the left wrist. Check that against how the chip sits on your board.
- **Haptic**: each buzz shakes the watch, lights the bezel, and shows the effect names (the
  DRV2605L library list) or sequence with an approximate length. TI doesn't publish exact effect
  lengths. A log of every haptic call and a *Mute* (no pulse; calls are still logged).
- **RTC** (Not responding by default): its time against this computer's clock, set it (or *Now*),
  run or stop it, and drift in ppm (20 ppm is about 1.7 s a day).
- **Touch**: where the finger is.
- **Buttons**: hold PB1 or PB2 with the mouse; `buttons_read()` reports pressed until you let
  go. With *Act like src/main.c* on, PB1 resets the watch and holding PB2 for 3 s enters USB mode,
  which is what `handle_buttons()` in `src/main.c` does. Turn it off once your `app/` code reads the buttons
  and does this itself.
- **Heart rate and microphone**: placeholders until they get hal/ headers.

The panel only shows what's in `web/devices.js`, so its settings survive a recompile or a reset,
and simulations (walking, battery) keep running. Reloading the page starts from the defaults;
saving setups is stage 7 (scenarios).

## Console and action log

Under the display, two tabs:

- **Console**: everything the firmware prints (`printf`), like the RTT log on the watch.
- **Action log**: every call from the firmware to the hardware layer that does something
  (init, buzz, set the RTC, accept a call, music command, reboot, USB mode), with the time since
  boot and the result. Failed calls are red. Reads (accelerometer, battery) aren't listed, since
  code usually polls those constantly.

The simulated hardware lives in the page (`web/devices.js`), so it keeps its state when the
watch restarts after a recompile or reset. A reset loses what a real reset loses: pending
interrupts and queued Bluetooth events. If the phone was bonded, it reconnects and sends the
time, the music state and the notifications already on it (flagged pre-existing), like an iPhone.

## Run it locally (Mac or Linux, no container)

You need Python 3, CMake (`brew install cmake`) and Emscripten (the C to WebAssembly compiler):

```sh
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
~/emsdk/emsdk install 6.0.12 && ~/emsdk/emsdk activate 6.0.12
```

Clone the firmware repo next to watch-sim (`../Smartwatch`), then from the watch-sim folder:

```sh
git submodule update --init   # fetches LVGL (build.sh also does this)
build/serve.py                # serves dist/ at http://localhost:8080, with the Compile button
build/compile.py              # or build from the terminal (the panel picks up the result)
```

`build/compile.py path/to/other-repo` builds a different firmware repo. The first build takes
about a minute because it compiles LVGL; after that only your files recompile (a few seconds).
`printf` output shows in the log box under the screen.

## How it fits together

| Path | What it does |
|---|---|
| `third_party/lvgl` | LVGL 8.3.7, the exact commit NCS 2.6 uses (git submodule) |
| `tools/gen_lv_autoconf.py` | Reads the firmware's `prj.conf` and runs it through LVGL's Kconfig, like Zephyr does, so the LVGL options (color depth, fonts, widgets) always match the watch |
| `build/lv_conf.h` | Simulator copy of Zephyr's `lv_conf.h`: memory, ticks, printf |
| `build/CMakeLists.txt`, `build/build.sh` | Compiles LVGL, `sim/`, `fakes/` and the firmware's `ui/` and `app/` into `dist/` |
| `sim/main.c` | The simulator's main: sets up a display and touch input like the watch's, calls `ui_init()` and `app_init()`, runs the main loop, and does the flush throttle |
| `fakes/` | Simulator versions of the firmware's `hal/` headers. `fake.c` is the bridge to `web/devices.js` |
| `sim/lvgl_mem.c` | LVGL's heap, capped at `CONFIG_LV_Z_MEM_POOL_SIZE` (16 KB) like on the watch |
| `repos.json` | Firmware repos to clone, and which one builds by default |
| `.devcontainer/` | Codespace image and setup hooks |
| `tools/codespace-setup.sh`, `tools/start-server.sh` | Codespace creation and start hooks |
| `tools/repos.py` | Reads `repos.json`; keeps `devcontainer.json` permissions in sync |
| `build/compile.py` | The one way in to a build: takes a lock, runs `build.sh`, writes the result and parsed errors to `.build/status.json` |
| `build/serve.py` | Serves `dist/` with caching off, plus a small `/api/` the panel uses to compile. Any static server can host `dist/`; the panel just hides the compile toolbar |
| `vscode/` | VS Code settings for `/workspaces`: IntelliSense from the build's compile commands, and the Ctrl+Shift+B build task |
| `web/` | The page: compile toolbar, round display with zoom and touch, error list and log. Copied into `dist/` on build |
| `web/config.js` | Panel facts: resolution, physical diameter, full-frame time |
| `web/devices.js` | The simulated hardware and iPhone: device states, event queues, Not responding switches, the battery and motion simulations |
| `web/devtools.js` | The dev tools panel: draws a section per device from `devices.js` and changes it |
| `dist/` | Build output. Plain static files that any web server can host |

Things that match the real watch:

- **LVGL settings** come from `prj.conf`: RGB565 with byte swap, Montserrat 14/20/28/48,
  default theme and widgets as Kconfig defaults them.
- **Render buffer** is 10% of the screen (`CONFIG_LV_Z_VDB_SIZE`), so LVGL draws in strips
  like on the watch.
- **CO5300 even-area rule** is applied by the simulated display, as `even_rounder` does in
  `src/main.c`.
- **Memory**: LVGL gets the same 16 KB. Running out prints `[sim] LVGL out of memory`.
- **Integer sizes**: WebAssembly is 32-bit like the nRF52840, so `int`, `long` and pointers
  are 4 bytes in both places.
- **Compiler warnings** use flags close to Zephyr's.
