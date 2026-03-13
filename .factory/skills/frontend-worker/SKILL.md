---
name: frontend-worker
description: Handles Vite + TypeScript frontend, canvas display rendering, keyboard/mouse input, controls UI, browser persistence, and emulator integration.
---

# Frontend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features involving:
- Vite + TypeScript project setup and configuration
- HTML/CSS layout and UI components
- Canvas display rendering (framebuffer polling, putImageData)
- Keyboard and mouse input capture and forwarding
- Emscripten module loading and initialization
- Browser storage (OPFS, IndexedDB) for persistence
- Controls UI (Start, Reboot, Wipe & Reset, Fullscreen, Debug panel)
- Loading/error state UX

## Work Procedure

### 1. Understand the Feature

Read the feature description, preconditions, expectedBehavior, and verificationSteps. Read `AGENTS.md` for boundaries and conventions. Read `.factory/library/` files for architecture and environment details. Read research docs if needed (QEMU_WASM_RESEARCH.md, QEMU_WASM_DISPLAY_RESEARCH.md).

### 2. Write Tests First (TDD)

Write Vitest unit tests BEFORE implementation:
- For input mapping: test scancode conversion (JS keycode -> QEMU scancode) for all key types
- For display: test pixel format conversion (BGRX -> RGBA), resolution handling
- For persistence: test storage layer (save/load/wipe operations)
- For controls: test state machine (button enabled/disabled logic)
- For error handling: test each error scenario produces correct message

Run tests — they MUST fail initially (red). Then implement to make them pass (green).

### 3. Implement

Follow the feature's expectedBehavior precisely. Key patterns:

**For Emscripten integration:**
- Load Wasm module using the generated JS glue (ES6 module import)
- Configure Module object with arguments, canvas reference, and callbacks
- Handle initialization: download progress -> Wasm compilation -> module ready
- QEMU args passed via Module['arguments'] array
- Set `Module['mainScriptUrlOrBlob']` for Web Worker URL
- Error handling: catch CompileError, LinkError, RangeError (OOM), Worker creation failure

**For display rendering:**
- Use `setInterval` at ~30ms (NOT requestAnimationFrame — rAF is hijacked by PROXY_TO_PTHREAD)
- Poll framebuffer via exported functions: `Module._qemu_display_data()`, `_qemu_display_width()`, `_qemu_display_height()`
- Read framebuffer from Wasm memory: `new Uint8ClampedArray(Module.HEAPU8.buffer, fbPtr, width * height * 4)`
- BGRX -> RGBA conversion: swap byte 0 (B) and byte 2 (R) for each pixel
- Handle VGA mode switches: check width/height changes, resize canvas
- Show loading indicator until first non-blank frame

**For keyboard input:**
- Capture `keydown` and `keyup` on the canvas container
- Map `KeyboardEvent.code` to QEMU scancodes (PS/2 Set 1)
- Call `Module._qemu_input_send_key(scancode, isDown ? 1 : 0)`
- Call `preventDefault()` for F-keys, Escape, and other interceptable shortcuts
- Only forward when canvas is focused (check `document.activeElement`)
- On focus loss (`blur` event), release all currently held keys
- Support key repeat: forward repeated keydown events as-is

**For mouse input:**
- Capture `mousemove`, `mousedown`, `mouseup` on canvas
- Convert to relative movement deltas
- Call `Module._qemu_input_send_mouse(dx, dy, buttons)`
- Consider Pointer Lock API for accurate relative input

**For controls UI:**
- Start button: disabled until Module ready; on click, start QEMU; disable while running
- Reboot button: enabled only while running; show confirmation dialog; reset QEMU state
- Debug panel: toggleable div showing timestamped log entries; capture console output
- Fullscreen: use Fullscreen API on canvas container; provide exit button

**For persistence (OPFS/IndexedDB):**
- Check OPFS availability: `navigator.storage.getDirectory()`
- Fallback to IndexedDB if OPFS unavailable
- Create disk image on first visit; detect existing image on return
- Resume choice UI: show dialog with "Resume" / "Start fresh" when saved state found
- Auto-save: periodic flush (every 30 seconds) + flush on `beforeunload`
- Wipe & Reset: clear storage, recreate empty disk, restart
- Request `navigator.storage.persist()` to reduce eviction risk

**For COOP/COEP headers (Vite config):**
```typescript
// vite.config.ts
server: {
  port: 3200,
  headers: {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp'
  }
}
```

### 4. Verify

Run full test suite: `npm test`
Run typecheck: `npm run typecheck`
Run lint: `npm run lint` (if configured)
Start dev server and verify in browser where possible.
Execute all verification steps from the feature definition.

### 5. Manual Verification with Browser

For features that affect the browser UI:
- Start the dev server (`npm run dev`)
- Open http://localhost:3200 in the browser
- Verify the specific behaviors described in expectedBehavior
- Check browser console for errors/warnings
- Test error paths (network errors, missing resources) where applicable

For each manual check, record: what you did, what you observed, and whether it matched expectations. Each check becomes an `interactiveChecks` entry in the handoff.

**IMPORTANT:** Do not leave the dev server running after verification. Kill it explicitly.

## Example Handoff

```json
{
  "salientSummary": "Implemented canvas display rendering with BGRX->RGBA conversion and VGA mode switch handling. Linux PoC boots successfully in browser with visible kernel messages on canvas. Keyboard input (typing in busybox shell) confirmed working. Ran `npm test` (12 tests passing) and `npm run typecheck` (clean).",
  "whatWasImplemented": "Created src/display.ts with setInterval-based render loop polling QEMU framebuffer via EMSCRIPTEN_KEEPALIVE exports. Pixel format conversion handles BGRX->RGBA swap. Canvas resizes on VGA mode changes via dpy_gfx_switch callback detection. Loading spinner shown until first non-blank frame. Integrated with Emscripten module loader.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "npm test", "exitCode": 0, "observation": "12 tests passing: 6 display tests (BGRX conversion, resize, mode switch), 4 scancode mapping tests, 2 module loader tests" },
      { "command": "npm run typecheck", "exitCode": 0, "observation": "No type errors" }
    ],
    "interactiveChecks": [
      { "action": "Started dev server, opened http://localhost:3200, clicked Start", "observed": "Loading spinner appeared, then Linux kernel boot messages rendered on canvas within 30 seconds. Canvas sized at 640x480." },
      { "action": "Typed 'ls' + Enter in busybox shell via browser keyboard", "observed": "Characters appeared on canvas with ~500ms latency. Directory listing rendered correctly." },
      { "action": "Checked browser console", "observed": "No errors or warnings. SharedArrayBuffer available. Emscripten module initialized." }
    ]
  },
  "tests": {
    "added": [
      { "file": "src/__tests__/display.test.ts", "cases": [
        { "name": "converts BGRX to RGBA correctly", "verifies": "Blue byte 0 maps to RGBA byte 2 (blue channel)" },
        { "name": "handles canvas resize on mode switch", "verifies": "Canvas width/height update when framebuffer dimensions change" },
        { "name": "detects first non-blank frame", "verifies": "Loading indicator hidden when framebuffer has >2 distinct colors" }
      ]},
      { "file": "src/__tests__/input.test.ts", "cases": [
        { "name": "maps KeyA to scancode 0x1E", "verifies": "Alphanumeric key mapping" },
        { "name": "maps Enter to scancode 0x1C", "verifies": "Special key mapping" },
        { "name": "maps F5 to scancode 0x3F", "verifies": "Function key mapping" }
      ]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Emscripten module fails to load and the error is not in the frontend code (build artifact issue)
- QEMU Wasm crashes during boot with errors originating in the Wasm binary
- Display backend exports are missing or have wrong signatures (C-side issue)
- SharedArrayBuffer not available despite COOP/COEP headers being set
- TempleOS boot hangs or crashes in ways that suggest hardware emulation issues (not frontend)
- Browser storage APIs behave unexpectedly (quota issues, permission denied)
- Feature depends on functionality not yet implemented by a previous feature
