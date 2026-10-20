/* hal/rtc.h in the simulator: RV-3028 whose time, running state and drift come from
 * the dev tools. devices.js keeps the clock as seconds since 1970 (in the watch's
 * local time; the RTC knows nothing about time zones). */
#define _DEFAULT_SOURCE   /* gmtime_r and timegm */
#include <errno.h>
#include <time.h>

#include "fake.h"
#include "hal/rtc.h"

int rtc_init(void)
{
    return fake_action("rtc", fake_check("rtc"), "rtc_init()");
}

int rtc_get_time(struct rtc_time *t)
{
    int ret = fake_check("rtc");
    if (ret) return ret;

    time_t secs = (time_t)fake_num("rtc", "now");
    struct tm tm;
    gmtime_r(&secs, &tm);
    t->year = (uint16_t)(tm.tm_year + 1900);
    t->month = (uint8_t)(tm.tm_mon + 1);
    t->day = (uint8_t)tm.tm_mday;
    t->hour = (uint8_t)tm.tm_hour;
    t->minute = (uint8_t)tm.tm_min;
    t->second = (uint8_t)tm.tm_sec;
    t->weekday = (uint8_t)tm.tm_wday;
    return 0;
}

int rtc_set_time(const struct rtc_time *t)
{
    int ret = fake_check("rtc");
    if (!ret && (t->year < 2000 || t->year > 2099 || t->month < 1 || t->month > 12 ||
                 t->day < 1 || t->day > 31 || t->hour > 23 || t->minute > 59 || t->second > 59)) {
        ret = -EINVAL;
    }
    if (!ret) {
        struct tm tm = {
            .tm_year = t->year - 1900, .tm_mon = t->month - 1, .tm_mday = t->day,
            .tm_hour = t->hour, .tm_min = t->minute, .tm_sec = t->second,
        };
        fake_call("rtc", "set", (double)timegm(&tm), 0);
    }
    return fake_action("rtc", ret, "rtc_set_time(%04u-%02u-%02u %02u:%02u:%02u)",
                       t->year, t->month, t->day, t->hour, t->minute, t->second);
}
