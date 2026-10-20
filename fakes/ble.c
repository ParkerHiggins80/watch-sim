/* hal/ble.h in the simulator: the Bluetooth dev tools play the part of the iPhone.
 * Events wait in a queue in devices.js; ble_poll() takes them one at a time. */
#include <errno.h>
#include <string.h>

#include "fake.h"
#include "hal/ble.h"
#include "hal/time.h"

#define TEXT(field, dst) fake_str("ble", "event." field, dst, sizeof(dst))

static const char *const CMD_NAMES[] = {
    "PLAY", "PAUSE", "TOGGLE", "NEXT", "PREVIOUS", "VOLUME_UP", "VOLUME_DOWN",
};

int ble_init(void)
{
    return fake_action("ble", fake_check("ble"), "ble_init()");
}

int ble_poll(struct ble_event *event)
{
    int ret = fake_check("ble");
    if (ret) return ret;
    if (!fake_call("ble", "next", 0, 0)) return 0;   /* queue empty */

    memset(event, 0, sizeof(*event));
    event->type = (enum ble_event_type)fake_int("ble", "event.type");
    switch (event->type) {
    case BLE_EVENT_LINK:
        event->link = (enum ble_link)fake_int("ble", "event.link");
        break;
    case BLE_EVENT_TIME:
        event->time.year = (uint16_t)fake_int("ble", "event.time.year");
        event->time.month = (uint8_t)fake_int("ble", "event.time.month");
        event->time.day = (uint8_t)fake_int("ble", "event.time.day");
        event->time.hour = (uint8_t)fake_int("ble", "event.time.hour");
        event->time.minute = (uint8_t)fake_int("ble", "event.time.minute");
        event->time.second = (uint8_t)fake_int("ble", "event.time.second");
        event->time.utc_offset_min = (int16_t)fake_int("ble", "event.time.utcOffsetMin");
        event->time.adjust_reason = (uint8_t)fake_int("ble", "event.time.adjustReason");
        break;
    case BLE_EVENT_NOTIF_ADDED:
        event->notif.category = (uint8_t)fake_int("ble", "event.notif.category");
        event->notif.flags = (uint8_t)fake_int("ble", "event.notif.flags");
        TEXT("notif.app", event->notif.app);
        TEXT("notif.title", event->notif.title);
        TEXT("notif.message", event->notif.message);
        /* fall through: removed events carry just the id */
    case BLE_EVENT_NOTIF_REMOVED:
        event->notif.id = (uint32_t)fake_num("ble", "event.notif.id");
        break;
    case BLE_EVENT_MUSIC:
        TEXT("music.title", event->music.title);
        TEXT("music.artist", event->music.artist);
        TEXT("music.album", event->music.album);
        event->music.state = (uint8_t)fake_int("ble", "event.music.state");
        event->music.elapsed_ms = (uint32_t)fake_num("ble", "event.music.elapsedMs");
        event->music.duration_ms = (uint32_t)fake_num("ble", "event.music.durationMs");
        event->music.volume = (uint8_t)fake_int("ble", "event.music.volume");
        event->music.updated_ms = time_ms();
        break;
    }
    return 1;
}

int ble_get_link(enum ble_link *link)
{
    int ret = fake_check("ble");
    if (ret) return ret;
    *link = (enum ble_link)fake_call("ble", "linkCode", 0, 0);
    return 0;
}

/* CTS, ANCS and AMS need an encrypted (bonded) link */
static int need_bonded(void)
{
    int ret = fake_check("ble");
    if (ret) return ret;
    return fake_call("ble", "linkCode", 0, 0) == BLE_LINK_BONDED ? 0 : -ENOTCONN;
}

int ble_notif_action(uint32_t id, enum ble_notif_action action)
{
    int ret = need_bonded();
    if (!ret && action != BLE_ACTION_POSITIVE && action != BLE_ACTION_NEGATIVE) ret = -EINVAL;
    if (!ret) fake_call("ble", "notifAction", id, action);
    return fake_action("ble", ret, "ble_notif_action(%u, %s)", (unsigned)id,
                       action == BLE_ACTION_POSITIVE ? "POSITIVE" :
                       action == BLE_ACTION_NEGATIVE ? "NEGATIVE" : "?");
}

int ble_music_command(enum ble_music_cmd cmd)
{
    int ret = need_bonded();
    int known = cmd >= BLE_MUSIC_PLAY && cmd <= BLE_MUSIC_VOLUME_DOWN;
    if (!ret && !known) ret = -EINVAL;
    if (!ret) fake_call("ble", "musicCommand", cmd, 0);
    return fake_action("ble", ret, "ble_music_command(%s)", known ? CMD_NAMES[cmd] : "?");
}
