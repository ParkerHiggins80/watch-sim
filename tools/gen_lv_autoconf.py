#!/usr/bin/env python3
"""Turn the firmware's prj.conf into the LVGL settings header the simulator compiles with.

On the watch, Zephyr reads prj.conf, runs it through LVGL's Kconfig file, and hands the
resulting CONFIG_LV_* defines to LVGL. This script does the same thing with the same
Kconfig file, so every LVGL option (widgets, fonts, color depth, themes, defaults for
anything prj.conf doesn't mention) matches the firmware build. Change prj.conf, rebuild,
and the simulator follows.

Usage: gen_lv_autoconf.py <lvgl dir> <prj.conf> <output header>
"""
import os
import re
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kconfiglib  # vendored copy, so no pip install is needed

# Zephyr-only LVGL options (memory pool, buffer size). LVGL's Kconfig doesn't know them,
# so they are passed straight through. Defaults are Zephyr's when prj.conf is silent.
ZEPHYR_ONLY = {
    "LV_Z_MEM_POOL_SIZE": "2048",
    "LV_Z_VDB_SIZE": "10",
}


def main():
    lvgl_dir, prj_conf, out_path = sys.argv[1:4]

    lv_lines, zephyr_vals = [], dict(ZEPHYR_ONLY)
    with open(prj_conf) as f:
        for line in f:
            m = re.match(r"\s*CONFIG_(LV_\w+)=(.*)", line)
            if not m:
                continue
            name, val = m.group(1), m.group(2).strip()
            if name.startswith("LV_Z_"):
                zephyr_vals[name] = val
            else:
                lv_lines.append(f"CONFIG_{name}={val}\n")

    # LVGL's Kconfig sits inside "if LVGL", which Zephyr turns on with CONFIG_LVGL=y.
    # A two-line wrapper defines that symbol and pulls in LVGL's file.
    os.environ["srctree"] = os.path.abspath(lvgl_dir)
    with tempfile.TemporaryDirectory() as tmpdir:
        top = os.path.join(tmpdir, "Kconfig")
        with open(top, "w") as f:
            f.write('config LVGL\n\tbool\n\tdefault y\nsource "Kconfig"\n')
        kconf = kconfiglib.Kconfig(top, warn_to_stderr=True)

        conf = os.path.join(tmpdir, "lv.conf")
        with open(conf, "w") as f:
            f.writelines(lv_lines)
        kconf.load_config(conf)

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    kconf.write_autoconf(out_path, header="/* Generated from prj.conf by gen_lv_autoconf.py. Do not edit. */\n")
    with open(out_path, "a") as f:
        f.write("\n/* Zephyr-only LVGL options */\n")
        for name, val in zephyr_vals.items():
            f.write(f"#define CONFIG_{name} {val}\n")


if __name__ == "__main__":
    main()
