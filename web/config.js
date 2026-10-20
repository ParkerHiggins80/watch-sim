// The physical panel the simulator imitates: a round 466x466 CO5300 AMOLED.
'use strict';

const PANEL = {
  // Pixels, same as HOR_RES / VER_RES in sim/main.c
  width: 466,
  height: 466,

  // Diameter of the lit (active) area in millimetres, for the "Real size" zoom mode.
  // 36.32 mm is 1.43", the usual size quoted for 466x466 CO5300 panels. Replace it with
  // the active area from your panel's datasheet.
  diameterMm: 36.32,

  // How long a full-screen redraw takes on the watch (SPI at 32 MHz), for the throttle
  fullFrameMs: 116,
};
