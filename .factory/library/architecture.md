# Architecture

Architectural decisions, patterns, and technical reference.

**What belongs here:** System design decisions, component interactions, data flow, integration patterns.

---

## System Overview

Browser-hosted full-system emulator (NOT a hypervisor) running TempleOS via QEMU compiled to WebAssembly.

```
┌─────────────────────────────────────────────────┐
│ Browser (Chrome/Firefox)                        │
│                                                 │
│  Main Thread                    Web Worker      │
│  ┌──────────────┐              ┌──────────────┐ │
│  │ UI Controls  │              │ QEMU Wasm    │ │
│  │ Canvas       │◄─ SharedAB ─►│ (x86_64)     │ │
│  │ Input Handler│              │              │ │
│  │ Storage Mgr  │              │ TempleOS     │ │
│  └──────────────┘              │ (guest)      │ │
│                                └──────────────┘ │
│  OPFS / IndexedDB                               │
│  ┌──────────────┐                               │
│  │ Disk Image   │                               │
│  └──────────────┘                               │
└─────────────────────────────────────────────────┘
```

## Component Interactions

### Display Pipeline
1. QEMU VGA device writes to DisplaySurface (BGRX format)
2. Custom display backend (ui/emscripten.c) exports framebuffer pointer via EMSCRIPTEN_KEEPALIVE
3. JavaScript setInterval loop (~30ms) polls framebuffer dimensions and data pointer
4. JS reads Wasm linear memory at the framebuffer pointer
5. BGRX → RGBA conversion for canvas ImageData
6. putImageData renders to canvas

### Input Pipeline
1. Browser keyboard events (keydown/keyup) captured on canvas container
2. KeyboardEvent.code mapped to PS/2 scancode (Set 1)
3. Exported C function _qemu_input_send_key(scancode, down) called
4. QEMU routes to PS/2 keyboard device model
5. TempleOS reads PS/2 input

Mouse: similar flow via _qemu_input_send_mouse(dx, dy, dz, buttons) where dz is scroll wheel delta

### QEMU Key Numbers vs PS/2 Scancodes
The C backend function `_qemu_input_send_key(keynum, down)` expects QEMU "key numbers", NOT raw PS/2 Set 1 scancodes. For standard keys (a-z, 0-9, Enter, Escape, etc.), key numbers match PS/2 Set 1 scancodes (0x00-0x7F). For **extended keys** (those with E0 prefix in PS/2), the key number is the base scancode OR'd with 0x80:
- Arrow keys: Up=0xC8, Down=0xD0, Left=0xCB, Right=0xCD
- Navigation: Insert=0xD2, Delete=0xD3, Home=0xC7, End=0xCF, PageUp=0xC9, PageDown=0xD1
- Right modifiers: RCtrl=0x9D, RAlt=0xB8
- Numpad special: KP_Enter=0x9C, KP_Divide=0xB5

Reference: QEMU source `ui/input-keymap.c`, `qcode_to_number` table.

### Persistence Pipeline
1. QEMU writes to virtual disk via IDE device model
2. Disk image stored in Emscripten virtual filesystem
3. Periodically (30s) and on beforeunload, disk image flushed to OPFS
4. On resume: disk image loaded from OPFS into Emscripten FS before QEMU starts

## QEMU Configuration

```
-m 512M (or 1024M)
-smp 1
-cdrom /pack/TempleOS.ISO
-boot d (or c for disk boot on resume)
-vga std
-display emscripten
-rtc base=localtime
-hda /pack/disk.img (writable virtual disk)
-accel tcg,tb-size=500
-nic none
```

## Key Design Decisions

1. **ktock/qemu-wasm fork over upstream**: Fork has TCG JIT backend for better performance. Upstream only has TCI (interpreter). Pinned to commit 8604ed49. Three source patches required: (a) osdep.h getloadavg guard for Emscripten, (b) memalign.c aligned_alloc fallback, (c) ui/meson.build to include emscripten.c.
2. **Custom display backend over SDL**: Emscripten SDL exists but QEMU's SDL backend has threading conflicts with PROXY_TO_PTHREAD. Custom backend is simpler and proven by pebble-qemu-wasm.
3. **setInterval over requestAnimationFrame**: rAF is hijacked by PROXY_TO_PTHREAD. setInterval works correctly from the main thread.
4. **OPFS over IndexedDB**: OPFS has synchronous access in workers, better for large file I/O. IndexedDB is the fallback.
5. **Bundle ISO in repo**: TempleOS ISO is 17MB, public domain. Bundling avoids CORS issues and external dependencies.
