/*
 * LVGL's heap, limited to CONFIG_LV_Z_MEM_POOL_SIZE like on the watch.
 *
 * Zephyr gives LVGL a sys_heap of that many bytes. Here each block gets a small header
 * (sys_heap has one too) and allocations fail with NULL once the total would go over
 * the limit. The overhead isn't byte-for-byte the same as sys_heap, so treat the limit
 * as a close estimate: if a screen gets near it in the simulator, it is near it on the
 * watch too.
 */
#include <stdlib.h>
#include <stdio.h>
#include "lvgl_mem.h"

#define POOL_SIZE CONFIG_LV_Z_MEM_POOL_SIZE
#define HDR       8   /* sys_heap chunk header is 8 bytes on a 32-bit target */

static size_t used, peak;

void *lvgl_malloc(size_t size)
{
    size_t need = (size + HDR + 7) & ~(size_t)7;
    if (used + need > POOL_SIZE) {
        printf("[sim] LVGL out of memory: wanted %u bytes, %u of %u used\n",
               (unsigned)size, (unsigned)used, (unsigned)POOL_SIZE);
        return NULL;
    }
    size_t *p = malloc(need);
    if (!p) return NULL;
    p[0] = need;
    used += need;
    if (used > peak) peak = used;
    return (char *)p + HDR;
}

void lvgl_free(void *ptr)
{
    if (!ptr) return;
    size_t *p = (size_t *)((char *)ptr - HDR);
    used -= p[0];
    free(p);
}

void *lvgl_realloc(void *ptr, size_t size)
{
    if (!ptr) return lvgl_malloc(size);
    if (size == 0) { lvgl_free(ptr); return NULL; }

    size_t old = ((size_t *)((char *)ptr - HDR))[0] - HDR;
    if (size <= old) return ptr;

    void *n = lvgl_malloc(size);
    if (!n) return NULL;
    for (size_t i = 0; i < old; i++) ((char *)n)[i] = ((char *)ptr)[i];
    lvgl_free(ptr);
    return n;
}

size_t lvgl_mem_used(void) { return used; }
size_t lvgl_mem_peak(void) { return peak; }
