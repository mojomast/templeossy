# QEMU Wasm Research Report

## 1. Project Overview

**Repository:** https://github.com/ktock/qemu-wasm (fork of qemu/qemu, 317 stars)
**Demo:** https://ktock.github.io/qemu-wasm-demo/
**Demo repo:** https://github.com/ktock/qemu-wasm-demo
**Author:** Kohei Tokunaga (NTT Corp)
**License:** GPLv2 (QEMU license)

QEMU Wasm compiles the full QEMU system emulator to WebAssembly using Emscripten, enabling it to run inside a web browser. It supports x86_64, aarch64, and riscv64 guest architectures.

---

## 2. Architecture: How It Works

### TCG/TCI Execution Path

QEMU Wasm adds a **custom TCG (Tiny Code Generator) backend** that translates QEMU's intermediate representation (IR) instructions into WebAssembly instructions. The execution uses browser APIs (`WebAssembly.Module` and `WebAssembly.Instance`) to run the generated Wasm code.

**Hybrid TCI + TCG approach:**
- Translation Blocks (TBs) run on **TCI (Tiny Code Interpreter)** by default (interpreted mode)
- Only TBs that execute frequently (e.g., 1000+ times) are compiled to WebAssembly modules
- This avoids excessive compilation overhead and browser limitations on the number of WebAssembly instances
- Each TB becomes a separate Wasm module that imports QEMU's memory and helper functions

**Key limitation:** Wasm's 32-bit memory model creates challenges for 64-bit guests. The current implementation uses SoftMMU for address translation with a partial workaround. True wasm64 support is waiting on broader browser adoption (Safari doesn't support it yet, nor does libffi).

### Upstreaming Status (as of early 2026)

- **TCI mode for 32-bit guests:** ✅ Upstreamed in **QEMU 10.1** (https://wiki.qemu.org/ChangeLog/10.1)
- **TCI mode for 64-bit guests:** Under discussion (PATCH v3 series)
- **TCG JIT mode:** Under discussion (PATCH v2 series)

This means **QEMU 10.1+ has official Emscripten/Wasm support** in the main tree, at least for TCI mode with 32-bit guests.

---

## 3. Build Process

### Toolchain
- **Emscripten SDK (emsdk)** v3.1.50 is used for cross-compilation
- All QEMU dependencies are cross-compiled with Emscripten inside a Docker container

### Dependencies (cross-compiled for Wasm)
| Library | Version |
|---------|---------|
| GLib | 2.75.0 (or 2.84.0 for upstream) |
| zlib | 1.3.1 |
| libffi | git commit adbcf2b... |
| Pixman | 0.42.2 (or 0.44.2 for upstream) |

### Docker-based Build (ktock/qemu-wasm fork)

The project provides a `Dockerfile` that builds all Emscripten-cross-compiled dependencies:

```bash
# Step 1: Build the Docker image with all dependencies
docker build -t build-qemu-wasm-tmp - < Dockerfile
docker run --rm -d --name build-qemu-wasm -v $(pwd):/qemu/:ro build-qemu-wasm-tmp

# Step 2: Configure QEMU for x86_64 Wasm target
EXTRA_CFLAGS="-O3 -g -Wno-error=unused-command-line-argument -matomics -mbulk-memory -DNDEBUG -DG_DISABLE_ASSERT -D_GNU_SOURCE -sASYNCIFY=1 -pthread -sPROXY_TO_PTHREAD=1 -sFORCE_FILESYSTEM -sALLOW_TABLE_GROWTH -sTOTAL_MEMORY=2300MB -sWASM_BIGINT -sMALLOC=mimalloc --js-library=/build/node_modules/xterm-pty/emscripten-pty.js -sEXPORT_ES6=1 -sASYNCIFY_IMPORTS=ffi_call_js"

docker exec -it build-qemu-wasm emconfigure /qemu/configure \
  --static --target-list=x86_64-softmmu --cpu=wasm32 --cross-prefix= \
  --without-default-features --enable-system --with-coroutine=fiber --enable-virtfs \
  --extra-cflags="$EXTRA_CFLAGS" --extra-cxxflags="$EXTRA_CFLAGS" \
  --extra-ldflags="-sEXPORTED_RUNTIME_METHODS=getTempRet0,setTempRet0,addFunction,removeFunction,TTY,FS"

# Step 3: Build
docker exec -it build-qemu-wasm emmake make -j $(nproc) qemu-system-x86_64
```

### Build Output Files
The build produces these key files:
- `qemu-system-x86_64` → renamed to `out.js` (Emscripten JS loader/glue)
- `qemu-system-x86_64.wasm` (the Wasm binary, ~33MB for arm, likely similar for x86_64)
- `qemu-system-x86_64.worker.js` (Web Worker for pthreads)

### QEMU 10.1+ Upstream Build (TCI-only mode)

For the upstream QEMU (simpler, TCI-only):
```bash
# Build the docker image from QEMU's own dockerfile
docker build -t qemu-wasm-base - < tests/docker/dockerfiles/emsdk-wasm32-cross.docker

# Configure and build
emconfigure configure --static --disable-tools --target-list=x86_64-softmmu
emmake make -j$(nproc)
```

### Key Emscripten Build Flags Explained

| Flag | Purpose |
|------|---------|
| `-sASYNCIFY=1` | Enables async/await support needed for QEMU's event loop |
| `-sPROXY_TO_PTHREAD=1` | Runs main() in a Web Worker, keeping the main thread responsive |
| `-sFORCE_FILESYSTEM` | Enables Emscripten's virtual filesystem |
| `-sALLOW_TABLE_GROWTH` | Needed for dynamic function pointer tables |
| `-sTOTAL_MEMORY=2300MB` | Guest RAM allocation (configurable) |
| `-sWASM_BIGINT` | Enables BigInt support for 64-bit integers |
| `-sEXPORT_ES6=1` | Produces ES6 module output |
| `-matomics -mbulk-memory` | Enables Wasm threading and bulk memory operations |
| `-sMALLOC=mimalloc` | Uses mimalloc allocator (some builds use emmalloc) |
| `--js-library=.../emscripten-pty.js` | Integrates xterm-pty for terminal I/O |
| `--with-coroutine=fiber` | Uses Emscripten's fiber coroutine backend |

---

## 4. Browser Integration

### 4.1 Disk Images / ISOs Loading

Disk images are **preloaded into Emscripten's virtual filesystem** using `file_packager.py`:

```bash
# Package all files in /pack/ directory into a single .data file
file_packager.py qemu-system-x86_64.data --preload /pack > load.js
```

This creates:
- `qemu-system-x86_64.data` — binary blob containing all files
- `load.js` — JavaScript that loads the data into Emscripten's FS

For large files (like Alpine rootfs), LZ4 compression is supported:
```bash
file_packager.py load-rootfs.data --lz4 --preload /pack-rootfs > load-rootfs.js
```

Files can be split into separate packs (kernel, initramfs, rootfs, ROM) for incremental loading.

**The files appear at their original paths inside QEMU's virtual filesystem** — QEMU accesses them as if they were local files (e.g., `/pack/rootfs.bin`).

### 4.2 QEMU Arguments (Module['arguments'])

QEMU command-line arguments are passed via the Emscripten `Module` object:

```javascript
// module.js — x86_64 example
Module['arguments'] = [
    '-nographic', '-m', '512M', '-accel', 'tcg,tb-size=500',
    '-L', '/pack/',
    '-nic', 'none',
    '-drive', 'if=virtio,format=raw,file=/pack/rootfs.bin',
    '-kernel', '/pack/bzImage',
    '-append', 'earlyprintk=ttyS0,115200n8 console=ttyS0,115200n8 root=/dev/vda rootwait ro loglevel=7',
];
```

For multi-threaded TCG (MTTCG):
```javascript
Module['arguments'] = [
    '-nographic', '-m', '512M', '-accel', 'tcg,tb-size=500,thread=multi', '-smp', '4,sockets=4',
    // ...
];
```

### 4.3 Display Output

**Current ktock/qemu-wasm examples use `-nographic` mode** with terminal output via xterm.js + xterm-pty. There is **NO built-in VGA/canvas display in the existing examples**.

However, the **pebble-qemu-wasm project** (https://github.com/ericmigi/pebble-qemu-wasm) demonstrates graphical display output:
- Uses `SharedArrayBuffer` for display framebuffer data
- Renders to HTML `<canvas>` element
- Uses `setInterval` for render loop (since `requestAnimationFrame` is hijacked by `PROXY_TO_PTHREAD`)
- Display controller writes frame data via emulated SPI

**For TempleOS (which requires VGA display)**, the approach would be:
1. Use QEMU's built-in VGA emulation (e.g., `-vga std`)
2. QEMU's display output would need to be routed to an HTML canvas
3. Emscripten's SDL support could potentially be used (`-display sdl` compiles SDL to canvas automatically)
4. Alternatively, a custom display backend could read the framebuffer and blit to canvas

**Important note:** The ktock/qemu-wasm fork currently focuses on `-nographic` mode. Adding graphical display would require additional work, but Emscripten natively supports SDL → canvas mapping, and QEMU already has SDL display support.

### 4.4 Keyboard Input

For terminal mode: **xterm-pty** library handles keyboard input:
- xterm.js provides the terminal UI
- xterm-pty creates a pseudo-terminal pair (master/slave)
- The PTY slave is attached to QEMU via `Module.pty`

For graphical mode (as shown by pebble-qemu-wasm):
- `SharedArrayBuffer` is used for button/key input from the main thread to the QEMU worker thread
- Keys are mapped from browser keyboard events to QEMU key codes
- A minimum key-hold duration may be needed for slow TCI execution

### 4.5 Required HTTP Headers

**Critical:** The server must set these headers for `SharedArrayBuffer` (required by Emscripten pthreads):
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Alternatively, use `coi-serviceworker.js` (as pebble-qemu-wasm does) for static hosting like GitHub Pages.

---

## 5. Embedding in a Web Page

### Minimal Example (Terminal Mode)

```html
<html>
  <head>
    <title>QEMU on browser(x86_64)</title>
    <link rel="stylesheet" href="./vendor/xterm.css" />
  </head>
  <body>
    <div id="terminal"></div>
    <script src="./load.js"></script>          <!-- preloaded disk images -->
    <script type="module">
      import 'https://unpkg.com/xterm@5.3.0/lib/xterm.js';
      import 'https://unpkg.com/xterm-pty/index.js';
      import './module.js'                      <!-- Module['arguments'] -->
      import initEmscriptenModule from './out.js';  <!-- compiled QEMU -->

      const xterm = new Terminal();
      xterm.open(document.getElementById("terminal"));
      const { master, slave } = openpty();
      xterm.loadAddon(master);
      Module.pty = slave;
      Module['mainScriptUrlOrBlob'] = location.origin + "/out.js";

      (async () => {
          const instance = await initEmscriptenModule(Module);
          var oldPoll = Module['TTY'].stream_ops.poll;
          var pty = Module['pty'];
          Module['TTY'].stream_ops.poll = function(stream, timeout){
              if (!pty.readable) {
                  return (pty.readable ? 1 : 0) | (pty.writable ? 4 : 0);
              }
              return oldPoll.call(stream, timeout);
          }
      })();
    </script>
  </body>
</html>
```

### Files Required for Deployment

| File | Description | Approximate Size |
|------|-------------|-----------------|
| `out.js` | Emscripten JS glue/loader | ~343KB |
| `qemu-system-x86_64.wasm` | QEMU Wasm binary | ~30-40MB |
| `qemu-system-x86_64.worker.js` | Web Worker for pthreads | Small |
| `qemu-system-x86_64.data` | Preloaded disk images + BIOS | Varies (depends on guest) |
| `load.js` | Data loader script | Small |

### Required BIOS/ROM Files for x86_64

```
bios-256k.bin
vgabios-stdvga.bin
kvmvapic.bin
linuxboot_dma.bin
efi-virtio.rom (if using virtio)
```

These come from QEMU's `pc-bios/` directory and must be included in the preloaded pack.

---

## 6. Prebuilt Binaries

### No Official Prebuilt Releases

The ktock/qemu-wasm repository has **no releases or prebuilt artifacts**. You must compile from source using the Docker-based build process.

### Demo Page as Source of Prebuilt Artifacts

The **qemu-wasm-demo** repository (https://github.com/ktock/qemu-wasm-demo) hosts prebuilt artifacts as GitHub Pages content in its `docs/` directory. These include compiled `.wasm`, `.js`, and `.data` files for the demo page, but are specific to the demo configurations (Alpine Linux, Raspberry Pi).

### Pebble Project Approach

The pebble-qemu-wasm project stores its built WASM artifacts (33MB .wasm) directly in the `web/` directory of the repo and serves them via GitHub Pages.

---

## 7. Demonstrated Guests

| Guest | Architecture | Status |
|-------|-------------|--------|
| Linux (busybox) | x86_64 | ✅ Fully working |
| Alpine Linux | x86_64 | ✅ With virtfs and networking |
| Linux (busybox) | aarch64 (raspi3ap) | ✅ Raspberry Pi emulation |
| Linux (busybox) | riscv64 | ✅ Working |
| PebbleOS | ARM (STM32F4) | ✅ Working (separate project) |
| Container images | Various | ✅ Via container2wasm integration |

---

## 8. Advanced Features

### Networking
- Browser-side networking is possible via WebSocket proxy
- Uses `container2wasm`'s `c2w-net-proxy.wasm` for network stack in browser
- Delegate mode: WebSocket URL passed to `Module['websocket']`
- Browser mode: Full network stack runs as Service Worker

### VirtFS (File Sharing)
- Files can be shared between JavaScript and guest VM via QEMU's virtfs
- Requires `--enable-virtfs` at build time and `-sASYNCIFY_IMPORTS=ffi_call_js`

### VM Migration
- Supports migrating VM state from native QEMU to browser QEMU
- Enables pre-booting a VM natively and then transferring it to browser

### Multi-threaded TCG (MTTCG)
- Supports multi-CPU emulation: `-accel tcg,tb-size=500,thread=multi -smp 4`

---

## 9. Performance Considerations

- **TCI mode is significantly slower** than native QEMU (interpreted, no JIT)
- The **TCG Wasm JIT backend** (in ktock/qemu-wasm fork) provides substantial speedup by compiling hot code paths to Wasm
- Pebble project reported **0.6 → 5.5 FPS (9.2x speedup)** with TCI optimizations:
  - `-O3 -flto -msimd128` build flags
  - Inline TLB fast path
  - ASYNCIFY_REMOVE for hot paths (44% overhead reduction)
  - Minimum icount budget to reduce lock contention
- Boot time for Alpine Linux: **2-4 minutes** in browser (estimated)
- Memory usage: **2300MB** total Wasm memory allocation

---

## 10. Gotchas, Limitations, and Known Issues

### Critical Limitations
1. **No built-in graphical display support** — existing examples only use `-nographic` terminal mode. VGA display to canvas would require additional work.
2. **64-bit guest support is a workaround** — relies on partial reverts of QEMU's removal of 32-bit host + 64-bit guest support. Proper fix awaits wasm64 adoption.
3. **Performance is slow** — TCI is an interpreter, much slower than native QEMU. Even with TCG JIT, it's constrained by Wasm overhead.
4. **Large binary size** — Wasm binary is ~33MB+ before compression.
5. **SharedArrayBuffer requirement** — needs COOP/COEP headers, which means static file serving (like simple `file://`) won't work.

### Browser Compatibility
- **Chrome/Firefox:** Fully supported (including wasm64 in latest versions)
- **Safari:** Works for 32-bit guests; wasm64 not supported
- **Mobile:** Not well tested; likely too slow

### Build Complexity
- Docker required for reproducible builds
- Multiple cross-compiled dependencies (glib, zlib, libffi, pixman)
- Emscripten SDK version pinning is important (v3.1.50 for fork, newer versions may have issues)

### TempleOS-Specific Considerations
- TempleOS requires **VGA display** (640x480 or similar) — will need SDL or custom display backend
- TempleOS requires **keyboard input** in graphical mode — needs key event translation
- TempleOS ISO (~20MB) needs to be preloaded via file_packager
- TempleOS may need specific BIOS files and PC hardware emulation
- x86_64 support is available but uses the 32→64 workaround
- Consider i386 target instead (avoids the wasm64 issue entirely, TempleOS is 64-bit though)

---

## 11. Key URLs and References

| Resource | URL |
|----------|-----|
| Main repo | https://github.com/ktock/qemu-wasm |
| Demo page | https://ktock.github.io/qemu-wasm-demo/ |
| Demo repo | https://github.com/ktock/qemu-wasm-demo |
| QEMU upstream patches (10-patch series) | https://patchew.org/QEMU/cover.1744032780.git.ktokunaga.mail@gmail.com/ |
| KVM Forum 2025 talk | https://pretalx.com/kvm-forum-2025/talk/EVRL9V/ |
| FOSDEM 2025 talk | https://fosdem.org/2025/schedule/event/fosdem-2025-6290-running-qemu-inside-browser/ |
| Pebble QEMU Wasm (graphical example) | https://github.com/ericmigi/pebble-qemu-wasm |
| Container2wasm integration | https://github.com/ktock/container2wasm |
| QEMU 10.1 TCI upstream | https://wiki.qemu.org/ChangeLog/10.1 |
| Sample repo (from upstream patches) | https://github.com/ktock/qemu-wasm-sample |
| v86 (alternative, x86 only, no 64-bit) | https://github.com/copy/v86 |
| Qemu.js (older alternative) | https://github.com/atrosinenko/qemujs |

---

## 12. Recommendation for TempleOS Emulator

### Approach A: Fork ktock/qemu-wasm (Recommended)
1. Build from the ktock/qemu-wasm fork (has TCG JIT for better performance)
2. Build `qemu-system-x86_64` targeting Wasm
3. Preload TempleOS ISO + BIOS files via `file_packager.py`
4. Add graphical display support (SDL → canvas or custom framebuffer backend)
5. Add keyboard input handling for graphical mode
6. Total Wasm binary: ~33-40MB + TempleOS ISO (~20MB)

### Approach B: Use QEMU 10.1+ upstream (TCI only)
1. Use official QEMU 10.1+ with Emscripten support
2. Simpler build, but TCI-only (slower, no JIT)
3. Same display/keyboard challenges
4. Better long-term maintainability as it's upstream

### Key Technical Decisions
- **Display:** Must solve VGA → canvas rendering. Options: Emscripten SDL, custom display backend, or framebuffer export
- **Input:** Keyboard events need to be captured and forwarded as PS/2 or USB HID events
- **Performance:** TempleOS is relatively lightweight, but TCI performance may be marginal. TCG JIT (from fork) strongly recommended.
- **ISO loading:** Use `file_packager.py --preload` for the TempleOS ISO
- **BIOS:** Include SeaBIOS (`bios-256k.bin`) and VGA BIOS (`vgabios-stdvga.bin`)
