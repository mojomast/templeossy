/*
 * Emscripten display backend for QEMU
 *
 * Provides a custom display backend that exports the VGA framebuffer
 * pointer, width, height, and stride to JavaScript via EMSCRIPTEN_KEEPALIVE
 * functions. JavaScript polls these values and renders to an HTML canvas.
 *
 * Also exports keyboard and mouse input functions that JavaScript calls
 * to forward user input events into the QEMU input subsystem.
 *
 * Display pixel format: QEMU DisplaySurface uses 32-bit BGRX.
 * JavaScript side must convert BGRX → RGBA for canvas ImageData.
 *
 * Usage with QEMU: Use -display none (QEMU's built-in none display).
 * After QEMU starts, JavaScript calls _qemu_setup_display() to attach
 * our DisplayChangeListener which captures the VGA framebuffer.
 *
 * Reference: pebble-qemu-wasm (ericmigi/pebble-qemu-wasm) for the
 * framebuffer-export pattern.
 *
 * Copyright (c) 2026 TempleOS Browser MVP Project
 * License: GPLv2 (QEMU license)
 */

#include "qemu/osdep.h"
#include "ui/console.h"
#include "ui/input.h"
#include "qapi/qapi-types-ui.h"

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

/* Shared state — exported to JavaScript via EMSCRIPTEN_KEEPALIVE */
static QemuConsole *emscripten_console;
static DisplayChangeListener *emscripten_dcl;
static int display_initialized = 0;

/* Framebuffer export state (volatile for cross-thread visibility) */
static volatile uint8_t *exported_fb_ptr = NULL;
static volatile int32_t fb_width = 0;
static volatile int32_t fb_height = 0;
static volatile int32_t fb_stride = 0;
static volatile int32_t fb_format = 0;  /* pixel format identifier */
static volatile int32_t frame_counter = 0;
static volatile int32_t fb_dirty = 0;   /* set when display updates */

/*
 * ==========================================================================
 * DisplayChangeListener callbacks
 * ==========================================================================
 */

/*
 * Called when a region of the display surface has been updated.
 * We update our exported framebuffer pointer and mark as dirty.
 */
static void emscripten_display_update(DisplayChangeListener *dcl,
                                       int x, int y, int w, int h)
{
    DisplaySurface *surface = qemu_console_surface(dcl->con);
    if (!surface) {
        return;
    }

    exported_fb_ptr = (uint8_t *)surface_data(surface);
    fb_width = surface_width(surface);
    fb_height = surface_height(surface);
    fb_stride = surface_stride(surface);
    fb_dirty = 1;
    frame_counter++;
}

/*
 * Called when the display surface changes (e.g., VGA mode switch).
 * TempleOS may change VGA modes during boot (text mode → graphics mode).
 * We update all exported dimensions and the framebuffer pointer.
 */
static void emscripten_display_switch(DisplayChangeListener *dcl,
                                       DisplaySurface *new_surface)
{
    if (!new_surface) {
        exported_fb_ptr = NULL;
        fb_width = 0;
        fb_height = 0;
        fb_stride = 0;
        return;
    }

    exported_fb_ptr = (uint8_t *)surface_data(new_surface);
    fb_width = surface_width(new_surface);
    fb_height = surface_height(new_surface);
    fb_stride = surface_stride(new_surface);
    fb_format = surface_format(new_surface);
    fb_dirty = 1;
    frame_counter++;
}

/*
 * Called periodically to refresh the display.
 * We call graphic_hw_update to trigger the VGA device to render,
 * then export the resulting framebuffer.
 */
static void emscripten_display_refresh(DisplayChangeListener *dcl)
{
    graphic_hw_update(dcl->con);
}

static const DisplayChangeListenerOps emscripten_display_ops = {
    .dpy_name           = "emscripten",
    .dpy_gfx_update     = emscripten_display_update,
    .dpy_gfx_switch     = emscripten_display_switch,
    .dpy_refresh        = emscripten_display_refresh,
};

/*
 * ==========================================================================
 * Exported functions (EMSCRIPTEN_KEEPALIVE)
 * ==========================================================================
 */

#ifdef __EMSCRIPTEN__

/* --- Display setup --- */

/*
 * Initialize the emscripten display backend.
 * Call from JavaScript after QEMU has started and its console is ready.
 *
 * Returns: 1 on success, 0 if console not ready yet, -1 if already init'd.
 */
EMSCRIPTEN_KEEPALIVE
int qemu_setup_display(void)
{
    if (display_initialized) {
        return -1;
    }

    emscripten_console = qemu_console_lookup_by_index(0);
    if (!emscripten_console) {
        return 0;
    }

    emscripten_dcl = g_new0(DisplayChangeListener, 1);
    emscripten_dcl->ops = &emscripten_display_ops;
    emscripten_dcl->con = emscripten_console;

    register_displaychangelistener(emscripten_dcl);
    display_initialized = 1;

    return 1;
}

/* --- Framebuffer access --- */

/*
 * Returns pointer to the raw framebuffer data in Wasm linear memory.
 * JavaScript reads this via Module.HEAPU8.buffer at the returned offset.
 * Pixel format is 32-bit BGRX (Blue, Green, Red, Unused).
 */
EMSCRIPTEN_KEEPALIVE
uint8_t *qemu_display_data(void)
{
    return (uint8_t *)exported_fb_ptr;
}

/* Returns the current display width in pixels */
EMSCRIPTEN_KEEPALIVE
int32_t qemu_display_width(void)
{
    return fb_width;
}

/* Returns the current display height in pixels */
EMSCRIPTEN_KEEPALIVE
int32_t qemu_display_height(void)
{
    return fb_height;
}

/* Returns the stride (bytes per row) of the framebuffer */
EMSCRIPTEN_KEEPALIVE
int32_t qemu_display_stride(void)
{
    return fb_stride;
}

/* Returns the frame counter — increments on each display update */
EMSCRIPTEN_KEEPALIVE
int32_t qemu_display_frame_count(void)
{
    return frame_counter;
}

/*
 * Returns 1 if the display has been updated since last check, then clears
 * the dirty flag. JavaScript uses this to avoid unnecessary canvas redraws.
 */
EMSCRIPTEN_KEEPALIVE
int32_t qemu_display_check_dirty(void)
{
    if (fb_dirty) {
        fb_dirty = 0;
        return 1;
    }
    return 0;
}

/* --- Keyboard input --- */

/*
 * Send a keyboard event to QEMU.
 *
 * @scancode: PS/2 Set 1 scancode (e.g., 0x1E for 'A', 0x01 for Escape)
 * @down: 1 for key press (make), 0 for key release (break)
 *
 * JavaScript captures keydown/keyup events, maps KeyboardEvent.code
 * to PS/2 scancodes, and calls this function.
 */
EMSCRIPTEN_KEEPALIVE
void qemu_input_send_key(int scancode, int down)
{
    if (!emscripten_console) {
        return;
    }
    qemu_input_event_send_key_number(emscripten_console, scancode, down);
}

/* --- Mouse input --- */

/*
 * Send a relative mouse motion + button event to QEMU.
 *
 * @dx: relative X movement (pixels)
 * @dy: relative Y movement (pixels)
 * @dz: scroll wheel delta (usually 0)
 * @buttons: button mask (bit 0 = left, bit 1 = right, bit 2 = middle)
 */
EMSCRIPTEN_KEEPALIVE
void qemu_input_send_mouse(int dx, int dy, int dz, int buttons)
{
    if (!emscripten_console) {
        return;
    }

    qemu_input_queue_rel(emscripten_console, INPUT_AXIS_X, dx);
    qemu_input_queue_rel(emscripten_console, INPUT_AXIS_Y, dy);

    qemu_input_queue_btn(emscripten_console, INPUT_BUTTON_LEFT,
                         (buttons & 0x1) != 0);
    qemu_input_queue_btn(emscripten_console, INPUT_BUTTON_RIGHT,
                         (buttons & 0x2) != 0);
    qemu_input_queue_btn(emscripten_console, INPUT_BUTTON_MIDDLE,
                         (buttons & 0x4) != 0);

    if (dz != 0) {
        qemu_input_queue_btn(emscripten_console,
                             dz > 0 ? INPUT_BUTTON_WHEEL_UP
                                    : INPUT_BUTTON_WHEEL_DOWN,
                             true);
        qemu_input_queue_btn(emscripten_console,
                             dz > 0 ? INPUT_BUTTON_WHEEL_UP
                                    : INPUT_BUTTON_WHEEL_DOWN,
                             false);
    }

    qemu_input_event_sync();
}

/*
 * Send an absolute mouse position to QEMU.
 *
 * @x: absolute X position (0-32767 range, scaled from canvas coordinates)
 * @y: absolute Y position (0-32767 range, scaled from canvas coordinates)
 * @buttons: button mask (bit 0 = left, bit 1 = right, bit 2 = middle)
 */
EMSCRIPTEN_KEEPALIVE
void qemu_input_send_mouse_abs(int x, int y, int buttons)
{
    if (!emscripten_console) {
        return;
    }

    qemu_input_queue_abs(emscripten_console, INPUT_AXIS_X, x, 0, 32767);
    qemu_input_queue_abs(emscripten_console, INPUT_AXIS_Y, y, 0, 32767);

    qemu_input_queue_btn(emscripten_console, INPUT_BUTTON_LEFT,
                         (buttons & 0x1) != 0);
    qemu_input_queue_btn(emscripten_console, INPUT_BUTTON_RIGHT,
                         (buttons & 0x2) != 0);
    qemu_input_queue_btn(emscripten_console, INPUT_BUTTON_MIDDLE,
                         (buttons & 0x4) != 0);

    qemu_input_event_sync();
}

#endif /* __EMSCRIPTEN__ */
