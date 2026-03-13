# User Testing

Testing surface, validation approach, and resource cost classification.

**What belongs here:** How to test the app's user-facing behavior, tool selection, setup, concurrency limits.

---

## Validation Surface

**Primary surface:** Web browser (Chrome via Playwright Chromium)
**Tool:** agent-browser
**URL:** http://localhost:3200
**Dev server command:** `npm run dev -- --port 3200`

### Prerequisites
- Playwright Chromium binary at `/home/mojo/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`
- **KNOWN ISSUE:** Playwright system dependencies (libnspr4, libnss3, etc.) may not be installed. If agent-browser fails with missing library errors, validators should fall back to curl-based verification and manual console checks where possible.
- Dev server must be started before testing
- COOP/COEP headers must be set (Vite config handles this)

### Testing Constraints
- TempleOS boot takes ~2-5 minutes under Wasm/TCI. Validators must use generous timeouts (300 seconds).
- Keyboard input has ~1 second latency. Allow time for input to be processed.
- VGA display updates at ~10-30 FPS depending on emulation speed.
- SharedArrayBuffer required — test browsers must support it.
- Canvas content verification: use `canvas.toDataURL()` or `getImageData()` for pixel sampling.

### Known Limitations
- Cannot OCR TempleOS screen content reliably. Validation relies on pixel color sampling (non-blank, distinct colors).
- Browser-reserved shortcuts (Ctrl+W, Ctrl+T) cannot be tested via agent-browser.
- Escape key in fullscreen: browser behavior, cannot be overridden.
- TempleOS has no serial output — all verification must be visual (canvas).
- **CRITICAL: TempleOS Boot Performance in Headless Chrome.** The QEMU Wasm emulator can start in headless Chrome (Worker memory allocation sometimes succeeds, sometimes fails depending on system memory state). However, even when the Worker starts successfully, TempleOS TCI emulation is extremely slow in headless Chrome and does NOT produce display output within the 300-second timeout. The canvas remains blank (all black, 1 color). The emulator enters "running" state (Reboot/Wipe buttons enabled, Start disabled) but BIOS/boot sequence doesn't render visible output. This blocks all assertions requiring interactive TempleOS: display validation, keyboard/mouse input, persistence after install, reboot, fullscreen. Previous sessions also reported Worker memory allocation failure (V8 "Array buffer allocation failed"), which may recur depending on system memory pressure.
- **Headless Chrome does not support Fullscreen API.** `requestFullscreen()` is a no-op in headless mode.

## Validation Concurrency

**Machine specs:** 4 CPUs, 16GB RAM (~9.6GB available)

**Per-validator cost estimate:**
- Playwright Chromium instance: ~300-500MB RAM
- QEMU Wasm in browser: ~2300MB Wasm memory (shared within one tab/instance)
- Dev server: ~200MB RAM (shared across validators)

**Total per validator:** ~2500-2800MB RAM

**Max concurrent validators: 2** (conservative)
- 2 validators × 2800MB = 5600MB
- Dev server: 200MB
- Total: ~5800MB, within 9.6GB available headroom at 70% = 6.7GB
- 3 validators would need ~8600MB, exceeding 70% headroom

**Rationale:** QEMU Wasm allocates 2300MB of Wasm linear memory per browser instance. This is the dominant cost. With only 4 CPU cores, concurrent QEMU instances would also compete for CPU time during the slow TCI emulation.

## Flow Validator Guidance: build-infra-cli

**Surface:** Command line / filesystem / Docker
**Testing tool:** Shell commands (Execute tool) — no browser needed for CLI assertions.

### What to test
Build infrastructure assertions verified through filesystem inspection and Docker commands:
- File existence and size checks (`ls -la`, `stat`)
- Docker image availability (`docker images`)
- Docker QEMU boot test (run QEMU in Docker, capture screendump)
- Git tracking verification (`git ls-files`)

### Isolation rules
- Do NOT stop or modify any running Docker containers
- Do NOT modify any build artifacts — read-only verification only
- Docker QEMU test should use a unique container name to avoid conflicts
- Port range 3200-3209 only; avoid all off-limits ports listed in AGENTS.md

### Key paths
- Build output: `/home/mojo/projects/templeossy/build/output/`
- Public emulator: `/home/mojo/projects/templeossy/public/emulator/`
- Assets: `/home/mojo/projects/templeossy/assets/`
- BIOS files: `/home/mojo/projects/templeossy/build/output/bios/`
- Docker test config: `/home/mojo/projects/templeossy/build/Dockerfile.qemu-test`
- Boot test script: `/home/mojo/projects/templeossy/build/boot-test.sh`
- Native validation docs: `/home/mojo/projects/templeossy/docs/native-qemu-validation.md`

### EMSDK 4.0.10 note
EMSDK 4.0.10 inlines Web Worker code in the main JS glue file. There is NO separate `.worker.js` file. VAL-BUILD-001 mentions "Web Worker script for pthreads" — this is satisfied by the inline worker in `qemu-system-x86_64.js`. Verify inline worker presence by grepping for `new Worker` or `PROXY_TO_PTHREAD` in the JS glue.

## Flow Validator Guidance: build-infra-browser

**Surface:** Web browser (dev server at http://localhost:3200)
**Testing tool:** `curl` for HTTP header and response checks; `agent-browser` only if needed for deeper browser verification.

### What to test
- Artifacts served by dev server without 404 errors
- TempleOS ISO fetchable without CORS errors
- MIME types correct (`.wasm` → `application/wasm`)
- All emulator files load with HTTP 200

### Isolation rules
- Dev server already running on port 3200
- Do NOT restart the dev server
- Read-only verification — do not modify served files

### Key URLs
- `http://localhost:3200/emulator/qemu-system-x86_64.wasm`
- `http://localhost:3200/emulator/qemu-system-x86_64.js`
- `http://localhost:3200/emulator/qemu-system-x86_64.data`
- `http://localhost:3200/emulator/load.js`

## Flow Validator Guidance: browser-boot-display

**Surface:** Web browser (http://localhost:3200)
**Testing tool:** `agent-browser` (Playwright Chromium) + `curl` for HTTP header checks

### What to test
This group validates HTTP headers, Emscripten module initialization, display rendering, loading UI, and control button states during boot. The validator must:

1. **HTTP header checks (curl-based):** Verify COOP/COEP headers, MIME types, and HTTP 200 responses for all emulator assets.
2. **Boot the emulator:** Navigate to http://localhost:3200, wait for loading to complete, click Start, and wait for TempleOS to boot (up to 300 seconds).
3. **Display validation:** Take canvas screenshots at intervals to verify:
   - Canvas is non-blank with multiple colors after boot
   - Canvas resolution is 640x480 (or integer multiple)
   - BGRX→RGBA conversion is correct (blue renders as blue, not red)
   - Display updates progressively during boot (at least 3 distinct visual states)
   - VGA mode switches don't crash
   - Loading indicator shows before first VGA frame
4. **Controls validation (pre-boot and during boot):**
   - Start button disabled during loading, enabled when ready, disabled after click
   - Reboot button disabled before emulator starts
   - Loading progress UI visible during asset download/compilation
   - Error state UI handles OOM and compilation failures

### How to check canvas content
```javascript
// In agent-browser evaluate:
const canvas = document.getElementById('display');
const ctx = canvas.getContext('2d');
const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
// Sample pixels at various positions to check for non-blank and color correctness
// Check canvas.width and canvas.height for resolution
```

### How to check display updates
Take screenshots at 30-second intervals. Compare them — at least one pixel change per 60-second window required. At least 3 distinct visual states needed.

### Timeouts
- Page load: 30 seconds
- Asset download + Wasm compilation: 120 seconds
- TempleOS boot to display output: 300 seconds total from Start click
- Take canvas snapshots every 30 seconds during boot

### Isolation rules
- Use session "fd146de0e125__displaygrp" for agent-browser
- Dev server on port 3200 is shared — read-only interaction
- Do NOT modify any files on disk
- Close browser session when done

## Flow Validator Guidance: browser-boot-input

**Surface:** Web browser (http://localhost:3200)
**Testing tool:** `agent-browser` (Playwright Chromium)

### What to test
This group validates keyboard input, mouse input, interactive controls (reboot, debug panel, fullscreen), and end-to-end flows. The validator must:

1. **Boot the emulator:** Navigate to http://localhost:3200, click Start, wait for TempleOS to boot (~300 seconds).
2. **Keyboard input validation:**
   - Type alphanumeric characters and verify canvas updates
   - Test special keys (Enter, Escape, Backspace, Tab, arrows)
   - Test function keys (F1-F12) — verify browser defaults prevented (F5 doesn't reload)
   - Test modifier keys (Shift+a = uppercase A)
   - Test canvas focus gating (click outside, type, verify no QEMU input)
   - Test key repeat (hold a key for 3 seconds)
   - Test cross-thread key delivery (type 50 chars)
   - Test stuck key prevention on focus loss
3. **Mouse input validation:**
   - Move mouse over canvas, verify TempleOS cursor moves
   - Click on canvas, verify click registers
4. **Interactive controls:**
   - Reboot button: click, confirm, verify boot restarts
   - Debug panel: toggle, verify entries persist
   - Fullscreen: enter, type, exit, verify emulator continues
5. **Cross-area flows:**
   - First-time visitor end-to-end (VAL-CROSS-001)
   - Fullscreen during active emulation (VAL-CROSS-006)
   - Linux guest PoC boot (VAL-CROSS-009) — may need config change or separate boot

### How to send keyboard input
```javascript
// agent-browser can use page.keyboard.press('a'), page.keyboard.type('hello'), etc.
// For special keys: page.keyboard.press('Enter'), page.keyboard.press('F5'), etc.
// For modifiers: page.keyboard.down('Shift'), page.keyboard.press('a'), page.keyboard.up('Shift')
```

### How to verify input was received
After sending input, wait 2-3 seconds (TCI latency), then take a canvas screenshot. Compare pixel data before and after — the canvas should have changed. Cannot reliably OCR text but can detect pixel differences.

### Timeouts
- TempleOS boot: 300 seconds from Start click
- Input response: 2-3 seconds per keystroke (TCI latency)
- Allow 30 seconds between input tests for emulator to process

### Isolation rules
- Use session "fd146de0e125__inputgrp" for agent-browser
- Dev server on port 3200 is shared — read-only interaction
- Do NOT modify any files on disk
- Close browser session when done

### VAL-CROSS-009 (Linux Guest PoC)
The Linux PoC may require checking if there's a way to select Linux guest mode vs TempleOS mode. Check the source code for configuration options. If not separately bootable from the UI, this may need to be validated by code inspection (verify the Linux PoC code exists and was demonstrated) rather than live boot.

## Flow Validator Guidance: persistence-ui

**Surface:** Web browser (http://localhost:3200)
**Testing tool:** `agent-browser` (Playwright Chromium)

### What to test
This group validates persistence UI elements and storage-related features that can be verified WITHOUT a live TempleOS boot. Since QEMU Wasm Worker memory allocation fails in headless Chrome, assertions requiring a running emulator will be marked blocked.

**Testable without boot:**
1. **Resume choice UX (VAL-PERSIST-009):** Seed IndexedDB with a disk image, then navigate to the page. Verify resume dialog appears with "Resume previous session" and "Start fresh" buttons. Click each and verify correct behavior (dialog dismisses, no errors).
2. **Multi-tab safety (VAL-CROSS-008):** Open two browser sessions to http://localhost:3200. Verify the second tab shows the multi-tab warning overlay.
3. **Wipe & Reset UI (VAL-PERSIST-005):** Seed storage, navigate, verify the wipe button exists. The full wipe flow requires a running emulator.
4. **First visit creates disk (VAL-PERSIST-001):** Navigate with empty storage. Verify no resume dialog appears. Check that the app attempts to create a disk (debug log entries).
5. **Storage quota handling (VAL-PERSIST-007):** Verify via code inspection and unit tests (62 storage tests + 31 persistence integration tests pass).

**Blocked by headless Chrome Worker memory limitation:**
- VAL-PERSIST-002, VAL-PERSIST-003, VAL-PERSIST-004, VAL-PERSIST-006, VAL-PERSIST-008
- All VAL-DISP-*, VAL-INPUT-*, VAL-CTRL-003, VAL-CTRL-006
- VAL-CROSS-001, VAL-CROSS-002, VAL-CROSS-003, VAL-CROSS-004, VAL-CROSS-006, VAL-CROSS-010

### How to seed storage for testing
```javascript
// In agent-browser evaluate to create a fake saved disk:
const db = await new Promise((resolve, reject) => {
  const request = indexedDB.open('templeossy-storage', 1);
  request.onupgradeneeded = () => { request.result.createObjectStore('disk-images'); };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const tx = db.transaction('disk-images', 'readwrite');
tx.objectStore('disk-images').put(new Uint8Array(1024), 'disk.img');
await new Promise((resolve) => { tx.oncomplete = resolve; });
db.close();
```

### How to check multi-tab safety
1. Open first session, navigate to http://localhost:3200
2. Open second session (different session ID), navigate to same URL
3. Check if multi-tab-warning element is visible in second tab

### Isolation rules
- Use session prefix "e0c5f12f0776__persist" for agent-browser
- Dev server on port 3200 is shared — read-only interaction
- Do NOT modify any files on disk
- Close all browser sessions when done
- Each test may need to clear IndexedDB between sub-tests

### Key DOM elements
- `#resume-dialog` — resume choice overlay (hidden by default)
- `#btn-resume` — resume button
- `#btn-fresh` — fresh boot button
- `#multi-tab-warning` — multi-tab warning overlay (hidden by default)
- `#btn-wipe` — wipe & reset button
- `#storage-toast` — storage notification toast
- `#loading-overlay` — loading overlay
- `#debug-panel` — debug log panel
