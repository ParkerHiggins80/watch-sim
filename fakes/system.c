/* hal/system.h in the simulator: the page restarts the watch or shows a USB mode screen */
#include <emscripten.h>
#include <emscripten/eventloop.h>

#include "fake.h"
#include "hal/system.h"

EM_JS(void, js_system, (int usb_mode), {
    if (Module.onSystem) Module.onSystem(usb_mode ? 'usb' : 'reboot');
});

/* Stop running firmware code, like the CPU resetting: cancel the main loop and
 * throw back out to the browser, so nothing after the call runs. */
static void halt(void)
{
    emscripten_cancel_main_loop();
    emscripten_unwind_to_js_event_loop();
}

void system_reboot(void)
{
    fake_action("system", 0, "system_reboot()");
    js_system(0);
    halt();
}

int system_enter_usb_mode(void)
{
    fake_action("system", 0, "system_enter_usb_mode()");
    js_system(1);
    halt();
    return 0;   /* not reached */
}
