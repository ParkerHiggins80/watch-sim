/* hal/buttons.h in the simulator: PB1 / PB2 in the dev tools */
#include <errno.h>

#include "fake.h"
#include "hal/buttons.h"

int buttons_init(void)
{
    return fake_action("buttons", fake_check("buttons"), "buttons_init()");
}

int buttons_read(enum button button, bool *pressed)
{
    int ret = fake_check("buttons");
    if (ret) return ret;
    if (button == BUTTON_PB1) *pressed = fake_int("buttons", "pb1");
    else if (button == BUTTON_PB2) *pressed = fake_int("buttons", "pb2");
    else return -EINVAL;
    return 0;
}
