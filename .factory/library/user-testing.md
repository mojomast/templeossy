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
- Playwright Chromium installed at `/home/mojo/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`
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
