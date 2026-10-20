/*
 * Simulator copy of Zephyr's modules/lvgl/include/lv_conf.h (NCS 2.6 / Zephyr 3.5.99-ncs1).
 *
 * Zephyr's lv_conf.h only covers memory, ticks and printf. Every other LVGL option
 * comes from prj.conf through Kconfig, which tools/gen_lv_autoconf.py reproduces into
 * lv_autoconf.h. This file swaps Zephyr's kernel calls for simulator ones.
 */
#ifndef LV_CONF_H
#define LV_CONF_H

/* Memory: the watch gives LVGL a private heap of CONFIG_LV_Z_MEM_POOL_SIZE bytes.
 * sim/lvgl_mem.c enforces the same limit, so running out of memory happens here too. */
#define LV_MEMCPY_MEMSET_STD 1
#define LV_MEM_CUSTOM        1
#define LV_MEM_CUSTOM_INCLUDE "lvgl_mem.h"
#define LV_MEM_CUSTOM_ALLOC   lvgl_malloc
#define LV_MEM_CUSTOM_REALLOC lvgl_realloc
#define LV_MEM_CUSTOM_FREE    lvgl_free

/* Ticks: the watch uses k_uptime_get_32(), milliseconds since boot */
#define LV_TICK_CUSTOM               1
#define LV_TICK_CUSTOM_INCLUDE       "sim_time.h"
#define LV_TICK_CUSTOM_SYS_TIME_EXPR (sim_uptime_ms())

#define LV_SPRINTF_CUSTOM  1
#define LV_SPRINTF_INCLUDE "stdio.h"
#define lv_snprintf        snprintf
#define lv_vsnprintf       vsnprintf

#define LV_CONF_SUPPRESS_DEFINE_CHECK 1

#endif /* LV_CONF_H */
