# TempleOSsy

A browser-hosted TempleOS emulator powered by QEMU compiled to WebAssembly. Boots TempleOS V5.03 directly in the browser with no plugins, downloads, or native software required.

## Features

- **Display rendering** -- QEMU VGA framebuffer rendered to an HTML canvas via a custom Emscripten display backend (BGRX to RGBA conversion at ~30 fps)
- **Keyboard input** -- Full keyboard capture with TempleOS scancode translation, including special keys and Ctrl/Alt/Shift modifiers
- **Mouse input** -- Absolute and relative mouse positioning with click and scroll support
- **Controls UI** -- Start, pause, resume, reset, and power-off controls with visual state indicators
- **Disk persistence** -- OPFS-backed virtual disk storage with IndexedDB fallback; survives page reloads
- **Multi-tab safety** -- Web Locks API prevents concurrent emulator instances from corrupting shared disk state
- **CD-only session protection** -- Detects sessions without a writable disk and skips persistence to avoid data loss

## Quick Start

```
npm install
npm run dev
```

Open http://localhost:3200 in a browser that supports SharedArrayBuffer (Chrome, Edge, or Firefox with appropriate headers). The TempleOS ISO is bundled in the repository -- no additional downloads needed.

Cross-origin isolation headers (`Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`) are configured automatically by the Vite dev server.

## Development Commands

| Command            | Description                          |
| ------------------ | ------------------------------------ |
| `npm run dev`      | Start Vite dev server on port 3200   |
| `npm run build`    | TypeScript check + Vite production build |
| `npm run preview`  | Preview the production build         |
| `npm run test`     | Run all 288 unit tests (Vitest)      |
| `npm run typecheck`| Type-check without emitting          |

## Architecture

```
Browser
  +-- Vite + vanilla TypeScript frontend
  |     src/main.ts        -- entry point, wires modules together
  |     src/display.ts     -- canvas rendering (polls QEMU framebuffer)
  |     src/input.ts       -- keyboard input handling
  |     src/mouse.ts       -- mouse input handling
  |     src/controls.ts    -- emulator control buttons and state machine
  |     src/loading.ts     -- boot progress UI
  |     src/emulator.ts    -- QEMU lifecycle management
  |     src/storage.ts     -- OPFS / IndexedDB disk persistence
  |     src/tab-lock.ts    -- multi-tab mutual exclusion via Web Locks
  |
  +-- QEMU Wasm (x86_64-softmmu)
  |     build/output/qemu-system-x86_64.wasm   -- ~25 MB Wasm binary
  |     build/output/qemu-system-x86_64.js     -- Emscripten JS glue
  |     build/output/bios/                     -- BIOS and VGA ROMs
  |
  +-- Custom Emscripten display backend
        build/emscripten.c -- EMSCRIPTEN_KEEPALIVE functions that expose
                              the VGA framebuffer pointer, dimensions,
                              and accept keyboard/mouse input from JS
```

The frontend polls exported C functions (`_qemu_display_data`, `_qemu_display_width`, etc.) each frame, copies the framebuffer into an `ImageData`, and draws it on a `<canvas>`. Input events flow in the reverse direction through `_qemu_input_send_key` and `_qemu_input_send_mouse_abs`.

Disk persistence writes the virtual hard drive image to the Origin Private File System (OPFS) after shutdown. On next boot, the stored image is loaded back, preserving any TempleOS files the user created.

## Building QEMU Wasm from Source

Pre-built artifacts are committed under `build/output/` so most developers do not need to rebuild QEMU. If you do need to rebuild:

```
./build/build.sh
```

This requires Docker with BuildKit. The script:

1. Builds a multi-stage Docker image that cross-compiles zlib, libffi, GLib, and Pixman with Emscripten SDK 4.0.10
2. Clones the [ktock/qemu-wasm](https://github.com/ktock/qemu-wasm) fork and injects the custom display backend (`build/emscripten.c`)
3. Configures and builds `qemu-system-x86_64` targeting wasm32
4. Extracts `.wasm`, `.js`, and BIOS artifacts to `build/output/`

Expect 20-40 minutes for a full build. Pass `--no-cache` to force a clean rebuild.

## Project Structure

```
assets/              TempleOS V5.03 ISO (bundled)
build/
  Dockerfile         Multi-stage QEMU Wasm build
  build.sh           Build orchestration script
  emscripten.c       Custom QEMU display backend
  output/            Pre-built Wasm artifacts and BIOS ROMs
public/emulator/     Emulator assets served statically
src/                 TypeScript source and tests
vite.config.ts       Vite configuration (port 3200, COOP/COEP headers)
```

## License

TempleOS and the TempleOS V5.03 ISO are public domain, as declared by Terry A. Davis.

QEMU is licensed under the GNU General Public License v2 (GPLv2). The custom Emscripten display backend (`build/emscripten.c`) is also GPLv2 to match.

The frontend TypeScript code in `src/` is not yet under a formal license.
