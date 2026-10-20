# watch-sim

A browser simulator for the Smartwatch firmware. It compiles the firmware's portable code
(`ui/`, later `app/`) together with LVGL 8.3 to WebAssembly and draws it on a 466x466 canvas.
See [SPEC.md](SPEC.md) for the full plan.

## Status

Stage 2 of 7: the Codespace sets itself up and opens the simulator in a VS Code pane.

## Codespace

Create a Codespace from this repo (Code > Codespaces > Create). GitHub will ask you to
approve write access to the repos in `repos.json`; accept, so you can push from the Codespace.
On creation it:

1. Builds the container from `.devcontainer/Dockerfile` (Emscripten 6.0.12, CMake, Python).
2. Runs `tools/codespace-setup.sh`: clones every repo in `repos.json` next to watch-sim,
   fetches LVGL, links `watch-sim/vscode/` to `/workspaces/.vscode`, and does a first build.
3. Runs `tools/start-server.sh` each time VS Code attaches (postAttachCommand), which serves `dist/` on port 8080.
   Codespaces notices the port and opens the simulator in a Simple Browser pane.
   Drag that tab next to your code.

VS Code opens `/workspaces`, so both repos are in the file tree and in Source Control.

If the pane is closed: Ports tab > port 8080 > "Preview in Editor" (the globe icon opens it
in a browser tab instead). After a rebuild, reload the pane.

### Adding a firmware repo

Add it to `repos.json`, then run `tools/repos.py sync-devcontainer` to request write access
for it in `devcontainer.json`. Commit both and rebuild the Codespace (Ctrl+Shift+P >
"Codespaces: Rebuild Container"). Setup warns if the two files disagree.

## Run it locally (Mac or Linux, no container)

You need Python 3, CMake (`brew install cmake`) and Emscripten (the C to WebAssembly compiler):

```sh
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
~/emsdk/emsdk install 6.0.12 && ~/emsdk/emsdk activate 6.0.12
```

Clone the firmware repo next to watch-sim (`../Smartwatch`), then from the watch-sim folder:

```sh
git submodule update --init   # fetches LVGL (build.sh also does this)
build/build.sh                # builds the default repo from repos.json into dist/
build/serve.py                # serves dist/ at http://localhost:8080
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
| `repos.json` | Firmware repos to clone, and which one builds by default |
| `.devcontainer/` | Codespace image and setup hooks |
| `tools/codespace-setup.sh`, `tools/start-server.sh` | Codespace creation and start hooks |
| `tools/repos.py` | Reads `repos.json`; keeps `devcontainer.json` permissions in sync |
| `build/serve.py` | Static web server with caching off, so reloads get the new build |
| `vscode/` | VS Code settings for `/workspaces` (IntelliSense from the build's compile commands) |
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
