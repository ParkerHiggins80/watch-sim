/* hal/imu.h in the simulator: LSM6DSO32 driven by the accelerometer dev tools */
#include <math.h>

#include "fake.h"
#include "hal/imu.h"

/* Same setup as src/main.c: +/-4 g full scale, 0.122 mg per step. Outside that
 * range the real chip saturates. */
#define FULL_SCALE_MG 4000.0
#define MG_PER_LSB    0.122

static int16_t to_mg(double g)
{
    double mg = g * 1000.0;
    if (mg > FULL_SCALE_MG) mg = FULL_SCALE_MG;
    if (mg < -FULL_SCALE_MG) mg = -FULL_SCALE_MG;
    /* Round to a whole sensor step, then scale like main.c's read_axes() */
    int16_t raw = (int16_t)lround(mg / MG_PER_LSB);
    return (int16_t)((int)raw * 122 / 1000);
}

int imu_init(void)
{
    return fake_action("imu", fake_check("imu"), "imu_init()");
}

int imu_read_accel(struct imu_accel *accel)
{
    int ret = fake_check("imu");
    if (ret) return ret;
    accel->x_mg = to_mg(fake_num("imu", "x"));
    accel->y_mg = to_mg(fake_num("imu", "y"));
    accel->z_mg = to_mg(fake_num("imu", "z"));
    return 0;
}

int imu_get_events(uint32_t *events)
{
    int ret = fake_check("imu");
    if (ret) return ret;
    *events = (uint32_t)fake_call("imu", "takeEvents", 0, 0);
    return 0;
}
