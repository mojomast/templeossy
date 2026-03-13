#!/bin/bash
# verify-wasm-build.sh — Verify QEMU Wasm build artifacts
#
# Checks that all required build artifacts exist with correct sizes.
# Used both as a post-build verification and as a test script.
#
# Exit code 0 = all checks pass, 1 = one or more failures

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$PROJECT_ROOT/build/output"

echo "=== QEMU Wasm Build Verification ==="
echo "Checking artifacts in: $OUTPUT_DIR"
echo ""

TOTAL=0
PASSED=0
FAILED=0

check() {
    local file="$1"
    local min_size="${2:-0}"
    local desc="$3"
    TOTAL=$((TOTAL + 1))

    if [ ! -f "$file" ]; then
        echo "  FAIL: $desc"
        echo "        File not found: $file"
        FAILED=$((FAILED + 1))
        return
    fi

    local size
    size=$(stat -c%s "$file")

    if [ "$size" -lt "$min_size" ]; then
        echo "  FAIL: $desc"
        echo "        Size: $size bytes (expected >= $min_size)"
        FAILED=$((FAILED + 1))
        return
    fi

    echo "  PASS: $desc ($size bytes)"
    PASSED=$((PASSED + 1))
}

echo "--- Main artifacts ---"
check "$OUTPUT_DIR/qemu-system-x86_64.wasm" 20971520 "Wasm binary (>= 20MB)"
check "$OUTPUT_DIR/qemu-system-x86_64.js" 1000 "JS glue/loader"

# Worker JS is optional — some Emscripten versions with PROXY_TO_PTHREAD
# inline the worker code rather than generating a separate .worker.js file
if [ -f "$OUTPUT_DIR/qemu-system-x86_64.worker.js" ]; then
    check "$OUTPUT_DIR/qemu-system-x86_64.worker.js" 100 "Web Worker script (optional)"
else
    echo "  INFO: No separate .worker.js found (worker code may be inlined in .js)"
fi

echo ""
echo "--- BIOS/ROM files ---"
check "$OUTPUT_DIR/bios/bios-256k.bin" 200000 "SeaBIOS ROM (bios-256k.bin)"
check "$OUTPUT_DIR/bios/vgabios-stdvga.bin" 30000 "VGA BIOS (vgabios-stdvga.bin)"
check "$OUTPUT_DIR/bios/kvmvapic.bin" 1000 "KVM VAPIC (kvmvapic.bin)"
check "$OUTPUT_DIR/bios/linuxboot_dma.bin" 1000 "Linux boot DMA (linuxboot_dma.bin)"

echo ""
echo "--- Display backend ---"
DISPLAY_BACKEND="$PROJECT_ROOT/build/emscripten.c"
TOTAL=$((TOTAL + 1))
if [ -f "$DISPLAY_BACKEND" ]; then
    KEEPALIVE_COUNT=$(grep -c 'EMSCRIPTEN_KEEPALIVE' "$DISPLAY_BACKEND")
    if [ "$KEEPALIVE_COUNT" -ge 6 ]; then
        echo "  PASS: emscripten.c has $KEEPALIVE_COUNT EMSCRIPTEN_KEEPALIVE exports"
        PASSED=$((PASSED + 1))
    else
        echo "  FAIL: emscripten.c only has $KEEPALIVE_COUNT EMSCRIPTEN_KEEPALIVE exports (need >= 6)"
        FAILED=$((FAILED + 1))
    fi
else
    echo "  FAIL: Display backend source not found: $DISPLAY_BACKEND"
    FAILED=$((FAILED + 1))
fi

echo ""
echo "=== Results: $PASSED/$TOTAL passed, $FAILED failed ==="

if [ "$FAILED" -gt 0 ]; then
    exit 1
fi
exit 0
