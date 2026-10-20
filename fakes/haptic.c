/* hal/haptic.h in the simulator: logs each buzz and tells the page to show a pulse */
#include <errno.h>
#include <stdio.h>

#include "fake.h"
#include "hal/haptic.h"

static int valid_effect(int e)
{
    return e >= 1 && e <= 123;
}

int haptic_init(void)
{
    return fake_action("haptic", fake_check("haptic"), "haptic_init()");
}

int haptic_play_effect(uint8_t effect)
{
    int ret = fake_check("haptic");
    if (!ret && !valid_effect(effect)) ret = -EINVAL;
    if (!ret) fake_call("haptic", "play", effect, 0);
    return fake_action("haptic", ret, "haptic_play_effect(%u)", effect);
}

int haptic_play_sequence(const uint8_t *steps, int count)
{
    int ret = fake_check("haptic");
    if (!ret && (count < 1 || count > 8)) ret = -EINVAL;
    for (int i = 0; !ret && i < count; i++) {
        if (!valid_effect(steps[i]) && steps[i] <= 0x80) ret = -EINVAL;
    }

    char list[8 * 5 + 1] = "";
    int n = 0;
    for (int i = 0; i < count && i < 8; i++) {
        n += snprintf(list + n, sizeof(list) - n, i ? ", %u" : "%u", steps[i]);
    }
    if (!ret) {
        fake_call("haptic", "sequenceStart", 0, 0);
        for (int i = 0; i < count; i++) fake_call("haptic", "sequenceStep", steps[i], 0);
        fake_call("haptic", "sequenceEnd", 0, 0);
    }
    return fake_action("haptic", ret, "haptic_play_sequence({%s}, %d)", list, count);
}

int haptic_stop(void)
{
    int ret = fake_check("haptic");
    if (!ret) fake_call("haptic", "stop", 0, 0);
    return fake_action("haptic", ret, "haptic_stop()");
}
