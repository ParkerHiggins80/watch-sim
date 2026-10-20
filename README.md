# watch-sim

A browser simulator for the Smartwatch firmware. It compiles the firmware's portable code
(`ui/`, later `app/`) together with LVGL 8.3 to WebAssembly and draws it on a 466x466 canvas.
See [SPEC.md](SPEC.md) for the full plan.

## Status

Stage 1 of 7: LVGL renders the placeholder screen from `Smartwatch/ui` in the browser.

## Run it

You need Emscripten (the C to WebAssembly compiler), Python 3 and CMake. Stage 2 will set
these up automatically in the Codespace. Until then, install Emscripten once:

```sh
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
~/emsdk/emsdk install 6.0.12 && ~/emsdk/emsdk activate 6.0.12
```

Then, from the watch-sim folder:

```sh
git submodule update --init   # fetches LVGL (build.sh also does this)
build/build.sh                # builds ../Smartwatch into dist/
build/serve.sh                # serves dist/ at http://localhost:8080
```

`build/build.sh path/to/other-repo` builds a different firmware repo. The first build takes
about a minute because it compiles LVGL; after that only your files recompile (a few seconds).
`printf` output shows in the log box under the screen.

## How it fits together

| Path | What it does |
|---|---|
| `third_party/lvgl` | LVGL 8.3.7, the exact commit NCS 2.6 uses (git submodule) |
| `tools/gen_lv_autoconf.py` | Reads the firmware's `prj.conf` and runs it through LVGL's Kconfig, like Zephyr does, so the LVGL options (color depth, fonts, widgets) always match the watch |
| `build/lv_conf.h` | Simulator copy of Zephyr's `lv_conf.h`: memory, ticks, printf |
| `build/CMakeLists.txt`, `build/build.sh` | Compiles LVGL, `sim/` and the firmware's `ui/` into `dist/` |
| `sim/main.c` | The simulator's main: sets up a display like the watch's, calls `ui_init()`, runs the main loop |
| `sim/lvgl_mem.c` | LVGL's heap, capped at `CONFIG_LV_Z_MEM_POOL_SIZE` (16 KB) like on the watch |
| `web/` | The page: canvas and log. Copied into `dist/` on build |
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
