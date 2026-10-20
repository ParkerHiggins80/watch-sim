/* hal/time.h in the simulator: milliseconds since the simulated watch started */
#include "hal/time.h"
#include "sim_time.h"

uint32_t time_ms(void)
{
    return sim_uptime_ms();
}
