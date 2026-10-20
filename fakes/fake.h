#ifndef FAKE_H
#define FAKE_H

/*
 * Bridge between the fakes (simulator versions of the firmware's hal/ headers) and the
 * simulated hardware in web/devices.js. The hardware state (battery level, link
 * state, sliders...) lives in the page, not in the WebAssembly, so it survives a
 * recompile and can be saved as a scenario. The fakes read it through these calls.
 *
 * device is a key in devices.js ("imu", "ble", ...); field is a property path in it,
 * like "z" or "event.notif.title".
 */

/* 0, or -EIO when the device is set to Not responding */
int fake_check(const char *device);

int fake_int(const char *device, const char *field);
double fake_num(const char *device, const char *field);
/* Copies a text field into buf (size bytes including the terminating 0, cut short if longer) */
void fake_str(const char *device, const char *field, char *buf, int size);

/* Calls a method of the device in devices.js and returns its number result */
double fake_call(const char *device, const char *method, double a, double b);

/* Writes "what -> result" to the action log and returns result, so a fake can end
 * with: return fake_action("haptic", ret, "haptic_play_effect(%d)", effect); */
int fake_action(const char *device, int result, const char *fmt, ...)
    __attribute__((format(printf, 3, 4)));

#endif /* FAKE_H */
