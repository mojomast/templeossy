# TempleOSsy

TempleOSsy is a browser-hosted QEMU-on-WebAssembly project for 64-bit x86 operating systems. It packages an `x86_64-softmmu` QEMU build, runs it in the browser with pthreads and `SharedArrayBuffer`, and renders the guest VGA framebuffer to an HTML canvas.

The current app focuses on booting TempleOS V5.03, but the underlying QEMU build targets 64-bit guest systems rather than a TempleOS-only runtime.

## What It Does

- Runs a 64-bit QEMU system emulator (`qemu-system-x86_64`) compiled to WebAssembly
- Boots bundled TempleOS media directly in the browser
- Supports a second Linux proof-of-concept boot path for display/runtime testing
- Renders VGA output through a custom QEMU display bridge in `build/emscripten.c`
- Captures keyboard and mouse input in the browser and forwards it into QEMU
- Persists the writable virtual disk with OPFS, with IndexedDB fallback

## Current Status

This project is experimental.

- The QEMU build and frontend are wired up end-to-end in the browser
- Cross-origin isolation is required because the emulator uses pthreads and `SharedArrayBuffer`
- The Wasm QEMU runtime reserves about 2.3 GB of shared memory, so browser memory pressure still matters
- TempleOS boot reliability and performance depend heavily on browser/runtime behavior

## Features

- `x86_64` guest support via QEMU Wasm, not a simplified VM stub
- Custom framebuffer export API: `_qemu_display_data`, `_qemu_display_width`, `_qemu_display_height`, `_qemu_display_stride`, `_qemu_display_check_dirty`
- Canvas renderer with stride-aware BGRX-to-RGBA conversion
- Keyboard and mouse forwarding into the guest
- Start, Reboot, Wipe & Reset, and Fullscreen controls
- Resume/fresh boot flow for existing saved TempleOS disk images
- Multi-tab disk safety through the Web Locks API
- Example Nginx and Caddy configs for COOP/COEP hosting

## Requirements

- A modern Chromium- or Firefox-class browser with `SharedArrayBuffer` support
- HTTPS or `localhost`
- Cross-origin isolation headers:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`
- Enough free memory for a large shared Wasm heap

## Quick Start

```bash
npm install
npm run dev
```

Then open `http://localhost:3200`.

The Vite dev server already sets the required COOP/COEP headers in `vite.config.ts`.

## Production-Style Local Hosting

If you want to serve the built app behind a normal web server instead of Vite:

1. Run `npm run build`
2. Serve `dist/` from a server that sends COOP/COEP headers
3. Open the site over `https://` or `localhost`

Example configs are included at:

- `deploy/nginx.conf`
- `deploy/Caddyfile`

Quick header checks:

```bash
curl -I http://localhost:3200/
curl -I http://localhost:3200/emulator/qemu-system-x86_64.wasm
```

## Development Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server on port 3200 |
| `npm run build` | Type-check and build the frontend |
| `npm run preview` | Preview the built frontend |
| `npm run test` | Run the Vitest suite |
| `npm run typecheck` | Run TypeScript without emitting output |

## Architecture

```text
Browser frontend
  src/main.ts       app bootstrap and lifecycle wiring
  src/emulator.ts   QEMU loader, runtime setup, boot arguments
  src/display.ts    framebuffer polling and canvas rendering
  src/input.ts      keyboard forwarding
  src/mouse.ts      mouse forwarding
  src/storage.ts    OPFS / IndexedDB virtual disk persistence

QEMU Wasm build
  build/Dockerfile  multi-stage Emscripten build pipeline
  build/build.sh    rebuild helper
  build/emscripten.c custom display/input bridge inside QEMU

Served emulator assets
  public/emulator/qemu-system-x86_64.js
  public/emulator/qemu-system-x86_64.wasm
  public/emulator/bios/
```

The display path is:

1. QEMU renders into its `DisplaySurface`
2. `build/emscripten.c` exports framebuffer pointer, dimensions, stride, and dirty state
3. `src/display.ts` polls those exports from the browser main thread
4. The framebuffer is copied into `ImageData` and drawn on a `<canvas>`

## Building QEMU Wasm From Source

Most frontend work does not require a QEMU rebuild because generated artifacts are already checked in.

To rebuild the emulator toolchain output:

```bash
./build/build.sh
```

This requires Docker with BuildKit. The build pipeline:

1. Uses Emscripten SDK 4.0.10 in a multi-stage Docker build
2. Builds QEMU dependencies for `wasm32`
3. Patches in the custom Emscripten display bridge
4. Builds `qemu-system-x86_64`
5. Exports the generated `.js`, `.wasm`, and BIOS assets into `build/output/`

Typical full rebuild time is on the order of tens of minutes.

## Boot Modes

- Default TempleOS mode boots the bundled `TempleOSCDV5.03.ISO`
- A Linux proof-of-concept mode is available for bring-up and diagnostics
- TempleOS sessions can resume from a saved writable disk image or start fresh from CD

## Persistence

- Saved disk images are stored in OPFS when available
- IndexedDB is used as a fallback backend
- The current initial writable disk size is 128 MB for browser practicality
- Wipe & Reset deletes the saved disk image and starts over

## Project Structure

```text
assets/                bundled boot media
build/                 QEMU Wasm build pipeline and custom C bridge
deploy/                example Nginx and Caddy configs
dist/                  built frontend output
public/emulator/       served QEMU Wasm artifacts and BIOS files
src/                   TypeScript app source and tests
vite.config.ts         dev server config with COOP/COEP headers
```

## Troubleshooting

**Keyboard not responding:** Click directly on the display canvas to focus it. The keyboard handler only forwards events when the display container has focus. After clicking Start, click the canvas area once more to ensure focus is set.

**Slow boot:** TempleOS takes 1-2 minutes to boot under QEMU Wasm TCI emulation. The display may appear frozen during this time. Wait for frames to start updating (visible in the Debug Log).

**TempleOS first-boot prompts:** On first boot from CD, TempleOS shows a white dialog box asking setup questions (install to hard drive, screen resolution, etc.). Answer with Y/N keys followed by Enter. This is normal TempleOS behavior.

**Out of memory:** The emulator requires ~2.3 GB of WebAssembly memory. Close other tabs and applications if the browser fails to allocate memory.

## Limitations

- Requires cross-origin isolation; plain `file://` or headerless static hosting will not work
- Browser memory limits can still prevent successful startup on some systems
- Boot performance is much slower than native QEMU
- The project currently targets browser experimentation, not production-grade VM hosting

## License

- TempleOS and the TempleOS V5.03 ISO are public domain as declared by Terry A. Davis
- QEMU is GPLv2
- `build/emscripten.c` follows GPLv2 to match QEMU integration requirements
- The frontend TypeScript code in `src/` does not yet declare a separate formal license
