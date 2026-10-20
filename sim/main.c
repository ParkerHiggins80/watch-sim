/*
 * Simulator main: the browser's counterpart of Smartwatch/src/main.c.
 *
 * It sets up LVGL with a display that matches the watch (466x466, RGB565, a render
 * buffer of CONFIG_LV_Z_VDB_SIZE percent of the screen, the CO5300 even-area rule),
 * calls ui_init() from the firmware's ui/ folder, then runs the main loop. The browser
 * calls loop() once per animation frame (about 60 times a second); everything LVGL
 * does happens inside that one call, so it stays on a single thread like the watch.
 */
#include <stdint.h>
#include <stdio.h>
#include <emscripten.h>
#include <lvgl.h>

#include "sim_time.h"
#include "ui_api.h"

#define HOR_RES 466
#define VER_RES 466

/* Same size Zephyr allocates: VDB_SIZE percent of the screen, in pixels */
#define BUF_PIXELS (HOR_RES * VER_RES * CONFIG_LV_Z_VDB_SIZE / 100)

static lv_color_t draw_buf_px[BUF_PIXELS];
static lv_disp_draw_buf_t draw_buf;
static lv_disp_drv_t disp_drv;

/* What the panel is showing, as RGBA bytes the browser canvas can use directly */
static uint8_t panel[HOR_RES * VER_RES * 4];
static int panel_dirty;

static double boot_ms;

uint32_t sim_uptime_ms(void)
{
    return (uint32_t)(emscripten_get_now() - boot_ms);
}

/* Hands a finished frame to web/sim.js, which draws it on the canvas */
EM_JS(void, js_present, (const uint8_t *px, int w, int h), {
    if (Module.onFrame) Module.onFrame(px, w, h);
});

/* CO5300 rule: every redraw area must start on even x/y and be even in size.
 * The watch sets this in src/main.c; the simulated panel has the same rule. */
static void even_rounder(lv_disp_drv_t *drv, lv_area_t *a)
{
    (void)drv;
    a->x1 &= ~1;
    a->y1 &= ~1;
    a->x2 |= 1;
    a->y2 |= 1;
}

/* LVGL calls this with each rendered strip. Copy it onto the panel, expanding
 * RGB565 to 8 bits per channel. LV_COLOR_GET_* undo the byte swap. */
static void flush_cb(lv_disp_drv_t *drv, const lv_area_t *a, lv_color_t *px)
{
    for (int y = a->y1; y <= a->y2; y++) {
        uint8_t *out = &panel[(y * HOR_RES + a->x1) * 4];
        for (int x = a->x1; x <= a->x2; x++, px++, out += 4) {
            uint32_t r = LV_COLOR_GET_R(*px), g = LV_COLOR_GET_G(*px), b = LV_COLOR_GET_B(*px);
            out[0] = (uint8_t)((r * 527 + 23) >> 6);
            out[1] = (uint8_t)((g * 259 + 33) >> 6);
            out[2] = (uint8_t)((b * 527 + 23) >> 6);
            out[3] = 255;
        }
    }
    panel_dirty = 1;
    lv_disp_flush_ready(drv);
}

static void loop(void)
{
    lv_timer_handler();

    if (panel_dirty) {
        panel_dirty = 0;
        js_present(panel, HOR_RES, VER_RES);
    }
}

/* web/sim.js calls this before starting a freshly compiled watch, so the old copy
 * stops drawing. Like pulling the battery: nothing is saved. */
EMSCRIPTEN_KEEPALIVE void sim_stop(void)
{
    emscripten_cancel_main_loop();
}

int main(void)
{
    boot_ms = emscripten_get_now();

    lv_init();

    lv_disp_draw_buf_init(&draw_buf, draw_buf_px, NULL, BUF_PIXELS);
    lv_disp_drv_init(&disp_drv);
    disp_drv.hor_res = HOR_RES;
    disp_drv.ver_res = VER_RES;
    disp_drv.flush_cb = flush_cb;
    disp_drv.rounder_cb = even_rounder;
    disp_drv.draw_buf = &draw_buf;
    lv_disp_drv_register(&disp_drv);

    printf("[sim] LVGL %d.%d.%d, %dx%d, %d-bit color\n", LVGL_VERSION_MAJOR,
           LVGL_VERSION_MINOR, LVGL_VERSION_PATCH, HOR_RES, VER_RES, LV_COLOR_DEPTH);

    ui_init();

    /* 0 = run at the browser's frame rate; 0 = return from main instead of blocking */
    emscripten_set_main_loop(loop, 0, 0);
    return 0;
}
