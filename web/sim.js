// Starts the compiled watch (watch.js / watch.wasm) and draws its frames on the canvas.
'use strict';

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const logEl = document.getElementById('log');

function log(text, cls) {
  const line = document.createElement('div');
  line.textContent = text;
  if (cls) line.className = cls;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

createWatch({
  // printf() in C ends up here
  print: (text) => log(text),
  printErr: (text) => log(text, 'err'),

  // sim/main.c calls this after LVGL redraws. px points at 466x466 RGBA bytes in WASM memory.
  onFrame(px, w, h) {
    const bytes = new Uint8ClampedArray(this.HEAPU8.buffer, px, w * h * 4);
    ctx.putImageData(new ImageData(bytes, w, h), 0, 0);
  },
}).catch((e) => log('Failed to start: ' + e, 'err'));
