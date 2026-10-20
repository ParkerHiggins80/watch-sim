#ifndef SIM_TIME_H
#define SIM_TIME_H

#include <stdint.h>

/* Milliseconds since the simulator booted, like k_uptime_get_32() on the watch */
uint32_t sim_uptime_ms(void);

#endif
