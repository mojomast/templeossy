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
