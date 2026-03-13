---
name: infra-worker
description: Handles Docker builds, QEMU Wasm compilation, C code for display backend, and native QEMU validation.
---

# Infrastructure Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features involving:
- Docker-based QEMU Wasm build pipeline
- C code for the custom Emscripten display backend (ui/emscripten.c)
- Native QEMU validation in Docker
- Build artifact packaging (file_packager.py, BIOS/ROM files)
- Any work that involves compiling QEMU or modifying its source

## Work Procedure

### 1. Understand the Feature

Read the feature description, preconditions, expectedBehavior, and verificationSteps carefully. Read `AGENTS.md` for boundaries and conventions. Read `.factory/library/architecture.md` and `.factory/library/environment.md` for technical context. Read the research documents in the repo root (QEMU_WASM_RESEARCH.md, QEMU_WASM_DISPLAY_RESEARCH.md, RESEARCH_QEMU_DOCKER_TESTING.md, RESEARCH_ISO_HOSTING.md) for detailed technical reference.

### 2. Write Tests First (Where Applicable)

For features that produce verifiable output (build artifacts, screenshots):
- Write a test script that checks expected outputs (file existence, size, format)
- Run the test — it should FAIL initially (red)
- Then implement to make it pass (green)

For Docker/build features, the "test" may be a shell script that verifies artifact existence and sizes.

### 3. Implement

Follow the feature's expectedBehavior precisely. Key patterns:

**For Docker builds:**
- Create Dockerfiles based on the ktock/qemu-wasm approach (Emscripten SDK 3.1.50)
- Cross-compile: GLib, zlib, libffi, Pixman for Emscripten
- Use `--without-default-features --enable-system` for QEMU configure
- Key build flags: `-sASYNCIFY=1 -sPROXY_TO_PTHREAD=1 -sTOTAL_MEMORY=2300MB -sWASM_BIGINT -sFORCE_FILESYSTEM`
- Build timeout: allow 60+ minutes for Docker builds

**For the display backend (ui/emscripten.c):**
- Register as a QEMU display backend using DisplayChangeListener API
- Export framebuffer pointer/dimensions via EMSCRIPTEN_KEEPALIVE
- Export keyboard input via qemu_input_send_key
- Export mouse input (relative movement + button state)
- Handle dpy_gfx_update and dpy_gfx_switch callbacks
- Reference the pebble-qemu-wasm approach (documented in QEMU_WASM_DISPLAY_RESEARCH.md)

**For native QEMU validation:**
- Use Docker image with qemu-system-x86_64
- TempleOS flags: `-display none -monitor telnet:0.0.0.0:4444,server,nowait -m 2048 -cdrom TempleOS.ISO -boot d -rtc base=localtime`
- Use IDE disk (not VirtIO), legacy BIOS
- Capture VGA screenshots via `screendump` monitor command
- TempleOS has NO serial output — screenshot is the only verification

**For asset packaging:**
- Use Emscripten file_packager.py to create .data + load.js files
- Include: BIOS files (bios-256k.bin, vgabios-stdvga.bin, kvmvapic.bin, linuxboot_dma.bin), TempleOS ISO
- Consider LZ4 compression for the ISO if supported

### 4. Verify

Run all verification steps from the feature definition. For build features:
- Check artifact existence and sizes
- Verify Docker build exit code
- For native QEMU: verify screendump is non-blank

Run the project's test suite: `npm test` (if tests exist at this point).
Run typecheck: `npm run typecheck` (if applicable).

### 5. Manual Verification

For build artifacts: manually inspect key files (ls -la, file type check).
For native QEMU: convert PPM screenshot to viewable format and inspect.
For display backend: review C code for correctness against QEMU DisplayChangeListener API.

Document all manual checks in the handoff.

## Example Handoff

```json
{
  "salientSummary": "Built QEMU Wasm for x86_64 with custom Emscripten display backend. Docker build completed in 28 minutes. Output: qemu-system-x86_64.wasm (34MB), JS glue (343KB), worker.js. Display backend exports framebuffer via EMSCRIPTEN_KEEPALIVE and accepts keyboard/mouse input.",
  "whatWasImplemented": "Created Dockerfile based on ktock/qemu-wasm with Emscripten SDK 3.1.50. Cross-compiled GLib 2.84.0, zlib 1.3.1, libffi, Pixman 0.44.2. Created ui/emscripten.c with DisplayChangeListener registration, framebuffer pointer export (qemu_display_data, qemu_display_width, qemu_display_height), keyboard input (qemu_input_send_key), and mouse input (qemu_input_send_mouse). Modified meson.build to include emscripten display backend. Build script (build.sh) handles full pipeline.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "docker build -t qemu-wasm-builder .", "exitCode": 0, "observation": "Docker image built successfully with all Emscripten dependencies" },
      { "command": "./build.sh", "exitCode": 0, "observation": "QEMU Wasm build completed in 28 minutes" },
      { "command": "ls -la dist/", "exitCode": 0, "observation": "qemu-system-x86_64.wasm (34,521,088 bytes), qemu-system-x86_64.js (343,012 bytes), qemu-system-x86_64.worker.js (4,521 bytes)" }
    ],
    "interactiveChecks": [
      { "action": "Inspected ui/emscripten.c for QEMU API compliance", "observed": "Uses DisplayChangeListener with dpy_gfx_update and dpy_gfx_switch. EMSCRIPTEN_KEEPALIVE on 6 exported functions. QKeyCode mapping for keyboard input." }
    ]
  },
  "tests": {
    "added": [
      { "file": "scripts/verify-build.sh", "cases": [{ "name": "check-wasm-exists", "verifies": "Wasm binary exists and is >= 20MB" }, { "name": "check-bios-files", "verifies": "All 4 BIOS/ROM files present" }] }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Docker build fails with unclear errors after debugging
- QEMU source modifications cause compilation errors that aren't straightforward to fix
- Emscripten version incompatibility issues
- Build output is unexpectedly small or missing components
- Native QEMU can't boot TempleOS (hardware compatibility issue)
- Feature depends on upstream qemu-wasm changes not yet available
