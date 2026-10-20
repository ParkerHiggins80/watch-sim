/* See fake.h. The EM_JS functions run JavaScript; Module.hw is the object from
 * createHardware() in web/devices.js. */
#include <errno.h>
#include <stdarg.h>
#include <stdio.h>
#include <emscripten.h>

#include "fake.h"
#include "sim_time.h"

EM_JS_DEPS(fake, "$UTF8ToString,$stringToUTF8");

EM_JS(int, js_enabled, (const char *device), {
    return Module.hw.get(UTF8ToString(device), 'enabled') ? 1 : 0;
});

EM_JS(double, js_num, (const char *device, const char *field), {
    return Number(Module.hw.get(UTF8ToString(device), UTF8ToString(field))) || 0;
});

EM_JS(void, js_str, (const char *device, const char *field, char *buf, int size), {
    const v = Module.hw.get(UTF8ToString(device), UTF8ToString(field));
    stringToUTF8(v == null ? "" : String(v), buf, size);
});

EM_JS(double, js_call, (const char *device, const char *method, double a, double b), {
    return Number(Module.hw.call(UTF8ToString(device), UTF8ToString(method), a, b)) || 0;
});

EM_JS(void, js_action, (const char *device, const char *text, double ms), {
    if (Module.onAction) Module.onAction(UTF8ToString(device), UTF8ToString(text), ms);
});

int fake_check(const char *device)
{
    return js_enabled(device) ? 0 : -EIO;
}

int fake_int(const char *device, const char *field)
{
    return (int)js_num(device, field);
}

double fake_num(const char *device, const char *field)
{
    return js_num(device, field);
}

void fake_str(const char *device, const char *field, char *buf, int size)
{
    js_str(device, field, buf, size);
}

double fake_call(const char *device, const char *method, double a, double b)
{
    return js_call(device, method, a, b);
}

static const char *err_name(int err)
{
    switch (err) {
    case -EIO: return "-EIO";
    case -EINVAL: return "-EINVAL";
    case -ENOTCONN: return "-ENOTCONN";
    case -ENODEV: return "-ENODEV";
    case -EBUSY: return "-EBUSY";
    default: return NULL;
    }
}

int fake_action(const char *device, int result, const char *fmt, ...)
{
    char text[160];
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(text, sizeof(text), fmt, ap);
    va_end(ap);

    if (n >= 0 && n < (int)sizeof(text)) {
        const char *name = err_name(result);
        if (name) snprintf(text + n, sizeof(text) - n, " -> %s", name);
        else snprintf(text + n, sizeof(text) - n, " -> %d", result);
    }
    js_action(device, text, sim_uptime_ms());
    return result;
}
