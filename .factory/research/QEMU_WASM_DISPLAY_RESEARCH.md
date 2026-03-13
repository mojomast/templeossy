# QEMU Wasm Display Research: VGA Output to HTML Canvas

## Executive Summary

Getting graphical (VGA) display output from QEMU Wasm into an HTML canvas is **not natively supported** by the upstream QEMU Wasm project. The upstream project (`ktock/qemu-wasm`) uses `-nographic` mode exclusively, routing all output through a terminal emulator (xterm-pty). However, there are **two proven approaches** for rendering graphical output, and a third promising but unverified approach.

---

## 1. The ktock/qemu-wasm-sample Setup (Terminal Only)

### How It Works
- **Repository**: https://github.com/ktock/qemu-wasm-sample
- The sample builds QEMU for x86_64-softmmu using Emscripten
- Uses `xterm-pty` (an on-browser terminal emulator integrated with Emscripten) for all I/O
- Command-line args always include `-nographic`
- HTML page creates an xterm.js terminal and connects it via a PTY to QEMU's serial output

### Key Files
- `samples/module.js` — Sets QEMU arguments including `-nographic`
  ```javascript
  Module['arguments'] = [
    '-nographic', '-m', '512M', '-accel', 'tcg,tb-size=500',
    '-L', 'pack/',
    '-drive', 'if=virtio,format=raw,file=pack/rootfs.bin',
    '-kernel', 'pack/kernel.img',
    '-append', 'earlyprintk=ttyS0 console=ttyS0 root=/dev/vda loglevel=7',
  ];
  ```
- `samples/index.html` — Uses xterm.js + xterm-pty for terminal display
- `Dockerfile` — Builds busybox rootfs + Linux kernel + QEMU with Emscripten

### Build Command
```bash
emconfigure /qemu/configure --static --disable-tools --target-list=x86_64-softmmu
emmake make -j$(nproc)
```

### Dependencies Cross-Compiled with Emscripten
- GLib 2.84.0, zlib 1.3.1, libffi 3.4.7, Pixman 0.44.2
- emsdk v3.1.50

### Limitations for TempleOS
- **No graphical display** — terminal only
- TempleOS requires VGA output — `-nographic` won't work
- The configure command uses `--disable-tools` and no display backend flags

---

## 2. The pebble-qemu-wasm Display Approach (RECOMMENDED REFERENCE)

### Overview
- **Repository**: https://github.com/ericmigi/pebble-qemu-wasm
- **Live demo**: https://ericmigi.github.io/pebble-qemu-wasm/
- Ports Pebble smartwatch QEMU device models to QEMU 10.1
- Compiles to WebAssembly with TCI interpreter backend
- **Successfully renders graphical display to HTML canvas**
- Uses a **custom device-specific approach** — not QEMU's standard display system

### Display Architecture (Key Technique)

The pebble-qemu-wasm project uses a **direct memory export approach** — the QEMU C code exposes the framebuffer memory pointer and dimensions via `EMSCRIPTEN_KEEPALIVE` functions, and JavaScript on the main thread polls this memory and renders to canvas using `setInterval`.

#### C Side (hw/display/pebble_snowy_display.c)

The display device code exports framebuffer info through Emscripten-exported functions:

```c
#ifdef __EMSCRIPTEN__
#include <emscripten.h>

static volatile uint8_t *pebble_wasm_fb_ptr = NULL;
static volatile int pebble_wasm_fb_width = 0;
static volatile int pebble_wasm_fb_height = 0;
static volatile int pebble_wasm_fb_stride = 0;
static volatile int pebble_wasm_frame_count = 0;

EMSCRIPTEN_KEEPALIVE int pebble_display_width(void) {
    return pebble_wasm_fb_width;
}
EMSCRIPTEN_KEEPALIVE int pebble_display_height(void) {
    return pebble_wasm_fb_height;
}
EMSCRIPTEN_KEEPALIVE int pebble_display_stride(void) {
    return pebble_wasm_fb_stride;
}
EMSCRIPTEN_KEEPALIVE int pebble_display_frame_count(void) {
    return pebble_wasm_frame_count;
}
EMSCRIPTEN_KEEPALIVE uint8_t *pebble_display_data(void) {
    return (uint8_t *)pebble_wasm_fb_ptr;
}
#endif
```

When the display device receives a complete frame via SPI, it updates the framebuffer and sets a redraw flag. The device also uses QEMU's standard `QemuConsole` and `ui/console.h` for its internal rendering pipeline (converting 8-bit color to RGB, applying overlays, etc.).

For WASM mode, a timer-based refresh loop is used instead of relying on QEMU's standard display update mechanism:
```c
#ifdef __EMSCRIPTEN__
    QEMUTimer *wasm_refresh_timer;
#endif
```

#### JavaScript Side (index.html)

The JavaScript side uses `setInterval` (not `requestAnimationFrame` — because rAF is hijacked by `PROXY_TO_PTHREAD`) to poll the framebuffer and render:

```javascript
// Poll framebuffer from WASM memory and render to canvas
setInterval(() => {
    const width = Module._pebble_display_width();
    const height = Module._pebble_display_height();
    const stride = Module._pebble_display_stride();
    const frameCount = Module._pebble_display_frame_count();
    const fbPtr = Module._pebble_display_data();
    
    if (width > 0 && height > 0 && fbPtr > 0) {
        // Read framebuffer from WASM memory (SharedArrayBuffer)
        const fb = new Uint8Array(Module.HEAPU8.buffer, fbPtr, height * stride);
        // Convert to RGBA ImageData and draw to canvas
        const imageData = ctx.createImageData(width, height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const pixel = fb[y * stride + x];
                // Convert 8-bit Pebble color (RRGGBB00) to RGBA
                const r = ((pixel >> 6) & 3) * 85;
                const g = ((pixel >> 4) & 3) * 85;
                const b = ((pixel >> 2) & 3) * 85;
                const idx = (y * width + x) * 4;
                imageData.data[idx] = r;
                imageData.data[idx + 1] = g;
                imageData.data[idx + 2] = b;
                imageData.data[idx + 3] = 255;
            }
        }
        ctx.putImageData(imageData, 0, 0);
    }
}, 100); // ~10 FPS polling
```

### Keyboard Input Handling

Button/keyboard input uses `SharedArrayBuffer` for cross-thread communication:

```javascript
// Keyboard events write to shared memory, QEMU reads from worker thread
document.addEventListener('keydown', (e) => {
    // Arrow keys map to Pebble buttons
    // SharedArrayBuffer used because QEMU runs in PROXY_TO_PTHREAD worker
});
```

Keys are mapped to GPIO state changes in the QEMU device model. The pebble project holds keys for 1 second minimum to ensure the firmware registers the press under slow TCI execution.

### Build Configuration

```bash
emconfigure /qemu-rw/configure \
    --static \
    --target-list=arm-softmmu \
    --without-default-features \
    --enable-system \
    --enable-tcg-interpreter \
    --disable-tools \
    --disable-docs \
    --disable-pie \
    --extra-cflags="-DSTM32_UART_NO_BAUD_DELAY -DTCI_INSTRUMENT -flto -msimd128" \
    --extra-ldflags="-flto"
```

### Key Observations
- Uses `--without-default-features` — **no SDL, no GTK, no display backends**
- Display is entirely custom: C exports framebuffer pointer → JS reads and renders
- Requires `SharedArrayBuffer` (COOP/COEP headers) for pthreads support
- Uses `PROXY_TO_PTHREAD` — QEMU main loop runs in a Web Worker
- FPS: ~5.5 FPS with optimizations (TCI interpreter is slow)
- `setInterval` used instead of `requestAnimationFrame` because rAF is hijacked by PROXY_TO_PTHREAD

---

## 3. QEMU's SDL Display Backend Under Emscripten

### Can It Work?

**Theoretically yes, but it has NOT been implemented or tested.** Here's the analysis:

#### Emscripten SDL2 Support
- Emscripten has a full SDL2 port (`emscripten-ports/SDL2`)
- SDL2 under Emscripten automatically maps to an HTML5 canvas element
- SDL2 window creation → canvas element; SDL2 rendering → WebGL/Canvas2D
- The canvas ID defaults to `#canvas` (configurable via `Module.canvas`)
- SDL2 input events (keyboard, mouse) work through Emscripten's event system

#### QEMU's SDL Display Backend
- QEMU has `ui/sdl2.c` — an SDL2-based display backend
- Activated with `--enable-sdl` at configure time and `-display sdl` at runtime
- Uses SDL2 for window creation, rendering, and input handling
- The SDL display backend reads from QEMU's `DisplaySurface` and blits to SDL window

#### The Gap
- **The upstream QEMU Wasm build does not enable SDL** — the configure command uses `--without-default-features` or `--disable-tools` with no `--enable-sdl`
- QEMU's `configure` and `meson.build` would need to detect Emscripten's SDL2 port
- The SDL2 display backend in QEMU assumes a native windowing environment (window positioning, resizing, multiple monitors, etc.) which would need stubs or modifications for Emscripten
- QEMU's threading model (PROXY_TO_PTHREAD) may conflict with SDL2's expectations about which thread handles events

#### What Would Be Needed
1. Cross-compile SDL2 for Emscripten (or use `--use-port=sdl2` flag)
2. Enable `--enable-sdl` in the QEMU Emscripten configure
3. Add Emscripten-specific adaptations to `ui/sdl2.c`
4. Handle the threading model (SDL events vs PROXY_TO_PTHREAD)
5. Ensure VGA device output reaches the SDL display surface

**This approach is possible but represents significant engineering effort** and hasn't been attempted by anyone publicly.

---

## 4. Upstream QEMU Emscripten Patches — No Display Work

### Status (as of March 2026)
- **QEMU 10.1**: TCI mode for 32-bit guests merged upstream (Emscripten cross-compilation support)
- **Pending**: TCI for 64-bit guests, TCG (JIT) backend
- **No display-related patches** have been submitted or discussed for Emscripten builds
- The upstream patches use `-nographic` exclusively
- The `configs/meson/emscripten.txt` cross-file has no SDL/display configuration

### Key Discussion Points from Upstream
- The focus is on getting the core emulation working (TCG backend, coroutines, filesystem)
- 64-bit guest support on 32-bit Wasm host is a known challenge (workaround: wasm64 when available)
- No mention of graphical display in any upstream discussion

---

## 5. Alternative Approaches for VGA → Canvas

### Approach A: Custom QEMU Display Backend for Emscripten (RECOMMENDED)

Create a new QEMU display backend (like `ui/emscripten.c`) that:

1. Registers as a QEMU display backend (similar to SDL, GTK, etc.)
2. In `dpy_gfx_update()`, exports the QEMU `DisplaySurface` data to JavaScript
3. Uses `EMSCRIPTEN_KEEPALIVE` functions to expose framebuffer pointer, width, height, stride
4. JavaScript polls the framebuffer and renders to canvas

This is essentially what pebble-qemu-wasm does, but generalized to work with QEMU's standard VGA device instead of a custom Pebble display device.

**Key code structure:**
```c
// ui/emscripten.c (new file)
#include "qemu/osdep.h"
#include "ui/console.h"
#include <emscripten.h>

static QemuConsole *active_console;
static volatile uint32_t *exported_fb = NULL;
static volatile int fb_width = 0, fb_height = 0;
static volatile int frame_counter = 0;

EMSCRIPTEN_KEEPALIVE uint32_t *qemu_display_data(void) { return (uint32_t *)exported_fb; }
EMSCRIPTEN_KEEPALIVE int qemu_display_width(void) { return fb_width; }
EMSCRIPTEN_KEEPALIVE int qemu_display_height(void) { return fb_height; }
EMSCRIPTEN_KEEPALIVE int qemu_display_frame_count(void) { return frame_counter; }

static void emscripten_display_update(DisplayChangeListener *dcl,
                                       int x, int y, int w, int h)
{
    DisplaySurface *surface = qemu_console_surface(dcl->con);
    exported_fb = (uint32_t *)surface_data(surface);
    fb_width = surface_width(surface);
    fb_height = surface_height(surface);
    frame_counter++;
}

static void emscripten_display_switch(DisplayChangeListener *dcl,
                                       DisplaySurface *new_surface)
{
    exported_fb = (uint32_t *)surface_data(new_surface);
    fb_width = surface_width(new_surface);
    fb_height = surface_height(new_surface);
}

// Keyboard input from JavaScript
EMSCRIPTEN_KEEPALIVE void qemu_input_send_key(int qcode, int down) {
    qemu_input_event_send_key_qcode(active_console, qcode, down);
}

static const DisplayChangeListenerOps emscripten_display_ops = {
    .dpy_name = "emscripten",
    .dpy_gfx_update = emscripten_display_update,
    .dpy_gfx_switch = emscripten_display_switch,
};

static void emscripten_display_init(DisplayState *ds, DisplayOptions *opts)
{
    DisplayChangeListener *dcl = g_new0(DisplayChangeListener, 1);
    dcl->ops = &emscripten_display_ops;
    active_console = qemu_console_lookup_default();
    dcl->con = active_console;
    register_displaychangelistener(dcl);
}

static QemuDisplay qemu_display_emscripten = {
    .type = DISPLAY_TYPE_EMSCRIPTEN, // would need to add this enum value
    .init = emscripten_display_init,
};

static void register_emscripten(void)
{
    qemu_display_register(&qemu_display_emscripten);
}
type_init(register_emscripten)
```

**JavaScript side:**
```javascript
const canvas = document.getElementById('display');
const ctx = canvas.getContext('2d');

setInterval(() => {
    const width = Module._qemu_display_width();
    const height = Module._qemu_display_height();
    const fbPtr = Module._qemu_display_data();
    
    if (width > 0 && height > 0 && fbPtr > 0) {
        canvas.width = width;
        canvas.height = height;
        // QEMU DisplaySurface is typically 32-bit BGRX
        const fb = new Uint8ClampedArray(Module.HEAPU8.buffer, fbPtr, width * height * 4);
        const imageData = new ImageData(fb, width, height);
        ctx.putImageData(imageData, 0, 0);
    }
}, 33); // ~30 FPS
```

**QEMU command-line:**
```
-display emscripten -vga std
```

### Approach B: Intercept QEMU's VGA Framebuffer Directly

Instead of creating a full display backend, directly read the VGA device's framebuffer memory:

1. Locate the VGA framebuffer in QEMU's address space
2. Export its address via `EMSCRIPTEN_KEEPALIVE`
3. Read it from JavaScript

This is fragile because VGA modes change and the framebuffer format varies. Not recommended.

### Approach C: VNC Display Backend

QEMU has a VNC server display backend. In theory:
1. Enable `-display vnc` in the WASM build
2. Use a JavaScript VNC client (noVNC) to connect
3. Route VNC traffic through WebSocket

This adds significant complexity and latency. Not recommended for this use case.

---

## 6. Keyboard Input in Graphical Mode

### For TempleOS specifically:
- TempleOS uses PS/2 keyboard (QEMU's default)
- QEMU's input subsystem receives key events and routes them to the PS/2 device model
- In the Emscripten display backend, JavaScript captures `keydown`/`keyup` events
- These are translated to QEMU key codes and sent via exported functions

### Key Code Mapping
```javascript
// Standard approach: map JavaScript KeyboardEvent.code to QEMU QKeyCode
const keyMap = {
    'KeyA': 0x1E, 'KeyB': 0x30, /* ... standard scancodes */
    'Enter': 0x1C, 'Escape': 0x01,
    'ArrowUp': 0x48, 'ArrowDown': 0x50,
    'ArrowLeft': 0x4B, 'ArrowRight': 0x4D,
    'F1': 0x3B, 'F2': 0x3C, /* ... */
};

document.addEventListener('keydown', (e) => {
    e.preventDefault();
    const scancode = keyMap[e.code];
    if (scancode !== undefined) {
        Module._qemu_input_send_key(scancode, 1); // key down
    }
});

document.addEventListener('keyup', (e) => {
    e.preventDefault();
    const scancode = keyMap[e.code];
    if (scancode !== undefined) {
        Module._qemu_input_send_key(scancode, 0); // key up
    }
});
```

### Threading Considerations
- QEMU runs in a Web Worker (PROXY_TO_PTHREAD)
- Keyboard events fire on the main thread
- `SharedArrayBuffer` is used for cross-thread communication
- The exported `_qemu_input_send_key` function call crosses thread boundaries

---

## 7. Build Flags Summary for Graphical QEMU Wasm

### Configure Flags
```bash
emconfigure /path/to/qemu/configure \
    --static \
    --target-list=x86_64-softmmu \
    --without-default-features \
    --enable-system \
    --enable-tcg-interpreter \
    --disable-tools \
    --disable-docs \
    --disable-pie \
    --extra-cflags="-O3 -flto -msimd128" \
    --extra-ldflags="-flto"
```

### Required Libraries (Cross-compiled for Emscripten)
- GLib 2.84.0
- zlib 1.3.1
- libffi 3.4.7
- Pixman 0.44.2 (important for display surface pixel manipulation)

### HTTP Headers Required
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```
These enable `SharedArrayBuffer` which is required for Emscripten's pthread support.

### Emscripten-Specific Settings (from configs/meson/emscripten.txt)
- `ASYNCIFY=1` — enables async operations in synchronous C code
- `PROXY_TO_PTHREAD=1` — runs main() in a worker thread
- `FORCE_FILESYSTEM=1` — enables Emscripten's virtual filesystem
- `ALLOW_TABLE_GROWTH=1` — needed for dynamic function pointers
- `TOTAL_MEMORY=2300MB` — large memory needed for QEMU
- `WASM_BIGINT=1` — enables BigInt for 64-bit integers

---

## 8. Recommended Approach for TempleOS VGA Display

### Primary Recommendation: Custom Emscripten Display Backend (Approach A)

**Rationale:**
1. Pebble-qemu-wasm proves the framebuffer-export pattern works
2. It integrates with QEMU's standard display system (`ui/console.h`)
3. Works with QEMU's standard VGA device (`-vga std`)
4. No need to modify VGA device code
5. Clean separation: C exports framebuffer, JS renders to canvas
6. Keyboard/mouse input handled via exported functions

### Implementation Steps:
1. Create `ui/emscripten.c` — new QEMU display backend
2. Register it as a QEMU display type
3. In `dpy_gfx_update`, export the `DisplaySurface` pixel data pointer
4. In `dpy_gfx_switch`, handle resolution/format changes
5. Add `EMSCRIPTEN_KEEPALIVE` exports for framebuffer access
6. Add keyboard input functions
7. JavaScript: poll framebuffer via `setInterval`, render with `putImageData`
8. Use `-display emscripten -vga std` to activate

### Performance Notes:
- TempleOS uses 640x480 VGA (or possibly higher resolution)
- At 640x480x4 bytes = ~1.2MB per frame
- JavaScript `putImageData` is efficient for this size
- `setInterval` at 30ms (~33 FPS) is sufficient
- The TCI interpreter will be the bottleneck, not display rendering
- Consider using `ImageBitmap` for better performance in the future

### v86 Reference:
- The v86 emulator (https://github.com/copy/v86) uses a similar approach
- It writes VGA framebuffer data directly from its emulator to a `<canvas>`
- Uses `screen_adapter.js` to convert VGA memory to canvas pixels
- Handles VGA mode changes (text mode, graphics modes, resolution changes)
- This is the same fundamental pattern: emulator exports framebuffer → JS renders

---

## 9. Key Unknowns and Risks

1. **DisplaySurface format**: QEMU's `DisplaySurface` is typically 32-bit BGRX. The JavaScript side needs to handle byte order conversion (BGRX → RGBA for canvas).

2. **VGA mode changes**: TempleOS may change VGA modes during boot. The display backend must handle `dpy_gfx_switch` callbacks properly.

3. **Mouse input**: TempleOS uses PS/2 mouse. Mouse events need similar export/import plumbing as keyboard.

4. **Performance**: TCI interpreter under Emscripten is slow (~5 FPS for Pebble). TempleOS is more complex than Pebble firmware, so expect even slower initial performance. The WASM JIT backend (TCG) would help significantly when available.

5. **64-bit host**: TempleOS is 64-bit x86. QEMU Wasm's 64-bit guest support on 32-bit Wasm host is a known challenge (see upstream discussion). This may require the workaround patches from the upstream patchset or waiting for wasm64 support.

---

## Sources

1. ktock/qemu-wasm-sample: https://github.com/ktock/qemu-wasm-sample
2. ktock/qemu-wasm: https://github.com/ktock/qemu-wasm
3. ericmigi/pebble-qemu-wasm: https://github.com/ericmigi/pebble-qemu-wasm
4. Upstream patches: https://patchew.org/QEMU/cover.1744032780.git.ktokunaga.mail@gmail.com/
5. QEMU Wasm demo: https://ktock.github.io/qemu-wasm-demo/
6. Emscripten SDL2 port: https://github.com/emscripten-ports/SDL2
7. v86 emulator: https://github.com/copy/v86
8. KVM Forum 2025 talk: https://pretalx.com/kvm-forum-2025/talk/EVRL9V/
