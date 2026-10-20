/* hal/fuel_gauge.h in the simulator: MAX17048 driven by the battery dev tools */
#include <math.h>

#include "fake.h"
#include "hal/fuel_gauge.h"

int fuel_gauge_init(void)
{
    return fake_action("fuel_gauge", fake_check("fuel_gauge"), "fuel_gauge_init()");
}

int fuel_gauge_read_voltage_mv(uint16_t *mv)
{
    int ret = fake_check("fuel_gauge");
    if (ret) return ret;
    *mv = (uint16_t)lround(fake_num("fuel_gauge", "mv"));
    return 0;
}

int fuel_gauge_read_percent(uint8_t *percent)
{
    int ret = fake_check("fuel_gauge");
    if (ret) return ret;
    double p = fake_num("fuel_gauge", "percent");
    *percent = (uint8_t)(p < 0 ? 0 : p > 100 ? 100 : lround(p));
    return 0;
}
