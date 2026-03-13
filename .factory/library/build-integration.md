# Build Integration

Cross-feature build integration knowledge and gotchas.

**What belongs here:** Dependencies between build steps, known integration risks, compatibility notes.

---

## LZ4 Compression: file_packager ↔ QEMU Build

The asset packaging script (`scripts/package-assets.sh`) uses Emscripten's `file_packager.py` with `--lz4` flag, producing `load.js` that expects `Module['LZ4']` at runtime. This requires the main QEMU Wasm binary to be compiled with `-sLZ4=1` so the Emscripten runtime provides the LZ4 decompressor.

**If the QEMU build does NOT include `-sLZ4=1`:** `load.js` will throw an assertion error: `"LZ4 not present - was your app build with -sLZ4?"`. Fix options:
1. Rebuild QEMU with `-sLZ4=1` added to LDFLAGS in `build/Dockerfile`
2. Re-run `package-assets.sh` without the `--lz4` flag (larger `.data` file, no compression)

**Current status:** Needs verification at frontend integration time. The QEMU JS glue (`qemu-system-x86_64.js`) has zero LZ4 references, suggesting `-sLZ4` was not included in the build.

## EMSDK Version

The project uses **EMSDK 4.0.10** (not 3.1.50 as originally planned). This version inlines Web Worker code in the main JS glue file — there is no separate `.worker.js` output.

## Required QEMU Source Patches

Three patches are applied during Docker build for Emscripten 4.x compatibility:
1. `osdep.h`: Guard `getloadavg` declaration for Emscripten
2. `memalign.c`: `aligned_alloc` fallback
3. `ui/meson.build`: Include `emscripten.c` display backend

These are applied via `sed` in the Dockerfile. If the QEMU source is updated, patches may need adjustment.
