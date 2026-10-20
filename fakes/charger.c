/* hal/charger.h in the simulator: BQ25185 STAT pins and USB power from the dev tools */
#include "fake.h"
#include "hal/charger.h"

int charger_init(void)
{
    return fake_action("charger", fake_check("charger"), "charger_init()");
}

int charger_read_stat_pins(int *stat1, int *stat2)
{
    int ret = fake_check("charger");
    if (ret) return ret;
    *stat1 = fake_int("charger", "stat1") ? 1 : 0;
    *stat2 = fake_int("charger", "stat2") ? 1 : 0;
    return 0;
}

int charger_read_usb_power(bool *present)
{
    int ret = fake_check("charger");
    if (ret) return ret;
    *present = fake_int("charger", "usb") != 0;
    return 0;
}
