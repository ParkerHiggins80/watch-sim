#ifndef SIM_LVGL_MEM_H
#define SIM_LVGL_MEM_H

#include <stddef.h>

void *lvgl_malloc(size_t size);
void *lvgl_realloc(void *ptr, size_t size);
void lvgl_free(void *ptr);

/* Bytes currently allocated by LVGL, and the most it has ever used */
size_t lvgl_mem_used(void);
size_t lvgl_mem_peak(void);

#endif
