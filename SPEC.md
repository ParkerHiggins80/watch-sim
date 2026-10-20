# Watch Simulator Spec

Put this file in the root of the watch-sim repo and tell Claude Code: "Read SPEC.md and start stage 1."

## Project context

I'm building a smartwatch on an nRF52840 with nRF Connect SDK 2.6 and LVGL 8.3. The display is a round 466x466 CO5300 AMOLED, and a full screen redraw takes about 116 ms on the real hardware. The watch uses anti-aliased Montserrat fonts. All firmware is currently in src/main.c of the Smartwatch repo.

I am learning C and LVGL. I will write all screens, screen logic, the screen manager, and app logic myself. Do not write those for me. Placeholders and empty stubs are fine.

## What I want

A development environment that runs in GitHub Codespaces where I can open a firmware repo, edit files, press compile, and see my code running on a simulated watch with dev tools for every piece of hardware.

## What VS Code already provides (do not rebuild)

The Codespace is VS Code in the browser, so these come for free: the file tree, opening files, split editors with resizable panes, the terminal, and git. Do not build an editor. Build the watch display and dev tools as a web page, and open it inside VS Code as a pane (Simple Browser) so I can dock it next to my code.

## Repos

1. watch-sim: this tool. The Codespace is created from this repo.
2. Smartwatch: my watch code, cloned next to watch-sim on Codespace creation.
3. A repos.json in watch-sim lists firmware repos to clone. The simulator has a dropdown to pick which cloned repo to build, defaulting to Smartwatch.
4. devcontainer.json requests write access to every repo in repos.json so I can push from the Codespace.

## Architecture

The simulator can only compile code that has no Zephyr, Bluetooth, or I2C calls in it. For sensor dev tools to be useful, the firmware needs a hardware layer with two implementations: the real one on the watch and a fake one in the simulator. This is a starter version. I will refine it.

```
Smartwatch/
├── ui/          LVGL only: screens, overlays, screen manager
│   └── ui_api.h     facts in, actions out
├── app/         portable logic: no Zephyr, no LVGL
│   └── app.h        app_init() and app_tick(), called by both mains
├── hal/         hardware interface headers only
│   ├── imu.h, haptic.h, fuel_gauge.h, charger.h, rtc.h
│   ├── ble.h, buttons.h, time.h (milliseconds since boot)
└── src/         watch only: Zephyr main.c and real drivers

watch-sim/
├── fakes/       simulator implementations of every hal/ header
├── web/         display, dev tools panel, console
└── build/       compiles ui/, app/, and fakes/ to WebAssembly
```

Every hal function returns 0 on success or a negative error code like the real Zephyr drivers (for example -EIO when a device does not answer), so my code learns to handle failures.

In Smartwatch, Claude Code may only create the new ui/ui_api.h, app/app.h, and hal/*.h headers plus empty stubs. Never edit src/main.c, prj.conf, CMakeLists.txt, or any existing file. I will connect the firmware side myself.

## The display

1. 466x466 with a round mask so corners are cut off like the real panel.
2. Zoom modes: fit to pane, 1:1 pixels, and real physical size. Real size uses the panel's active area diameter from a config value, with a calibration step (hold a credit card to the screen and match a rectangle).
3. Mouse acts as touch, including press, drag, and long press.
4. Optional throttle that limits redraws to the real 116 ms full frame time.
5. Optional overlay showing which regions LVGL redrew on each frame.

## Compiling

1. A Compile button in the simulator panel.
2. The same build as a VS Code task bound to Ctrl+Shift+B, with a gcc problem matcher so errors appear in the Problems panel and clicking one jumps to the line.
3. Build errors also show in the simulator panel instead of a blank screen.
4. A toggle for auto compile on save, off by default.
5. Recompiling keeps the dev tools state (battery level, connection state, and so on) so I don't have to set it up again.

## Dev tools panel

Every device has an Enabled / Not responding toggle. Not responding makes its hal functions return -EIO, so I can test how my code handles a broken part.

1. Accelerometer (LSM6DSO32): x, y, z sliders in g. Presets for flat on a table, wrist raised, arm down, and walking with noise. A Raise wrist button that animates a real raise motion. Buttons to fire the wake and tilt interrupt events.
2. Haptic (DRV2605L): an on screen pulse when a buzz plays, showing the effect number or pattern and its duration. A log of every haptic call. A mute toggle.
3. Fuel gauge (MAX17048, I2C 0x36): voltage and percent sliders. A discharge simulation for a 500 mAh cell at a chosen current, with a speed multiplier, using a realistic LiPo curve (for reference, 3.96 V read as 72% on the real watch). Defaults to Not responding to match the current board.
4. Charger (BQ25185 STAT1 on P1.04, STAT2 on P1.06): USB plugged in toggle and a state picker for no input, charging, charge complete, and fault, shown as the STAT1 and STAT2 pin levels my code would read.
5. RTC (RV-3028): set its time, run or stop it, and add drift. Defaults to Not responding to match the current board.
6. Touch: shows the current touch coordinates and has an Enabled toggle.
7. Buttons: PB1 restarts the simulator like a reset. PB2 triggers USB mode.
8. Bluetooth:
   1. Link state: advertising, connected, bonded, disconnected.
   2. Time sync (Current Time Service): send phone time now, or a custom time, date, and time zone change.
   3. Notifications (ANCS): app presets (Messages, Mail, Instagram, Calendar) with title and message fields, a long text option to test truncation, remove a notification by id, send a burst of 10, and pre-existing notifications sent on connect.
   4. Calls: incoming call with caller name, call ended. Accept and decline actions show in the action log.
   5. Music (AMS): title, artist, album, playing or paused, track position, and volume. Play, pause, next, previous, and volume actions show in the action log.
9. Heart rate (MAX30102) and microphone: placeholders for later.

## Console and logs

1. A console showing everything my code prints, like the RTT log on the real watch.
2. An action log of every call from my code to the hardware layer (haptic buzzes, USB mode, call accept, music controls), with timestamps.

## Scenarios

Save and load the whole dev tools state as named scenarios, stored as JSON files in the firmware repo so they follow me between devices. For example: "low battery while charging" or "notification burst while disconnected."

## Future proofing

The simulator's compiled output must be a plain folder of static files (HTML, JS, WASM) that any web server or a future desktop app could load. Codespaces is only the development environment, so nothing in the simulator itself should depend on it. The same setup should also work locally on my Mac.

## Rules

1. LVGL is not thread safe. Fact functions and all LVGL calls happen only from the main loop, same as on the watch.
2. Use LVGL 8.3, the same version as my SDK, and an lv_conf.h that matches my firmware's LVGL settings (check prj.conf and the build output for color depth and fonts).
3. Explain what each part does and why as you go, briefly. Keep a README with how to run everything.
4. Work in stages and stop after each one so I can test.

## Stages

1. LVGL renders a placeholder label in the browser from Smartwatch/ui.
2. Codespace setup: devcontainer, cloning repos, write access, the simulator opening in a VS Code pane.
3. Compile button, VS Code task with problem matcher, and errors shown in the panel.
4. Round mask, zoom modes, touch, and the redraw throttle.
5. The hal/ and app/ headers, fakes, console, and action log.
6. Dev tools panel: Bluetooth first, then fuel gauge and charger, then accelerometer, haptic, RTC, touch, and buttons.
7. Scenarios and the redraw region overlay.
