#!/bin/bash
# build.sh — Build QEMU Wasm with custom Emscripten display backend
#
# This script handles the complete build pipeline:
# 1. Build Docker image with all cross-compiled dependencies + QEMU
# 2. Extract build artifacts (.wasm, .js, .worker.js, BIOS files)
# 3. Verify output
#
# Usage:
#   ./build/build.sh              # Full build
#   ./build/build.sh --no-cache   # Full build without Docker cache
#
# Expected time: ~20-40 minutes (mostly cross-compiling dependencies)
# Expected output: build/output/ directory with all artifacts

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$SCRIPT_DIR"
OUTPUT_DIR="$BUILD_DIR/output"
IMAGE_NAME="qemu-wasm-builder"

# Parse args
DOCKER_BUILD_ARGS=""
if [[ "${1:-}" == "--no-cache" ]]; then
    DOCKER_BUILD_ARGS="--no-cache"
fi

echo "=== QEMU Wasm Build Pipeline ==="
echo "Project root: $PROJECT_ROOT"
echo "Build dir:    $BUILD_DIR"
echo "Output dir:   $OUTPUT_DIR"
echo ""

# Step 1: Build Docker image (targeting the qemu-build stage for extraction)
echo "=== Step 1: Building Docker image (this takes 20-40 minutes) ==="
echo "Image name: $IMAGE_NAME"
echo ""

DOCKER_BUILDKIT=1 docker build \
    $DOCKER_BUILD_ARGS \
    --target qemu-build \
    -t "$IMAGE_NAME" \
    -f "$BUILD_DIR/Dockerfile" \
    "$BUILD_DIR"

echo ""
echo "=== Step 2: Extracting build artifacts ==="

# Clean previous output
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

# Create a temporary container and copy artifacts out
CONTAINER_ID=$(docker create "$IMAGE_NAME" /bin/true)

# Copy QEMU output files
docker cp "$CONTAINER_ID:/output/." "$OUTPUT_DIR/" 2>/dev/null || {
    echo "WARNING: Could not copy from /output/. Trying alternative paths..."
    # Try the build directory directly
    docker cp "$CONTAINER_ID:/qemu/build/qemu-system-x86_64" "$OUTPUT_DIR/qemu-system-x86_64.js" 2>/dev/null || true
    docker cp "$CONTAINER_ID:/qemu/build/qemu-system-x86_64.wasm" "$OUTPUT_DIR/" 2>/dev/null || true
    docker cp "$CONTAINER_ID:/qemu/build/qemu-system-x86_64.worker.js" "$OUTPUT_DIR/" 2>/dev/null || true
    # Copy BIOS files
    mkdir -p "$OUTPUT_DIR/bios"
    docker cp "$CONTAINER_ID:/qemu/pc-bios/bios-256k.bin" "$OUTPUT_DIR/bios/" 2>/dev/null || true
    docker cp "$CONTAINER_ID:/qemu/pc-bios/vgabios-stdvga.bin" "$OUTPUT_DIR/bios/" 2>/dev/null || true
    docker cp "$CONTAINER_ID:/qemu/pc-bios/kvmvapic.bin" "$OUTPUT_DIR/bios/" 2>/dev/null || true
    docker cp "$CONTAINER_ID:/qemu/pc-bios/linuxboot_dma.bin" "$OUTPUT_DIR/bios/" 2>/dev/null || true
}

# Remove temporary container
docker rm "$CONTAINER_ID" > /dev/null 2>&1 || true

echo ""
echo "=== Step 3: Verifying build artifacts ==="

# Verification
PASS=true

check_file() {
    local file="$1"
    local min_size="${2:-0}"
    local desc="$3"

    if [ ! -f "$file" ]; then
        echo "FAIL: $desc — file missing: $file"
        PASS=false
        return 1
    fi

    local size
    size=$(stat -c%s "$file")

    if [ "$size" -lt "$min_size" ]; then
        echo "FAIL: $desc — file too small: $size bytes (expected >= $min_size)"
        PASS=false
        return 1
    fi

    echo "PASS: $desc — $file ($size bytes)"
    return 0
}

# Check main artifacts
check_file "$OUTPUT_DIR/qemu-system-x86_64.wasm" 20971520 "Wasm binary (>= 20MB)"
check_file "$OUTPUT_DIR/qemu-system-x86_64.js" 1000 "JS glue code"
# Worker JS is optional — some Emscripten versions inline worker code
if [ -f "$OUTPUT_DIR/qemu-system-x86_64.worker.js" ]; then
    check_file "$OUTPUT_DIR/qemu-system-x86_64.worker.js" 100 "Worker JS"
else
    echo "INFO: No separate .worker.js (worker code inlined in main .js)"
fi

# Check BIOS files
check_file "$OUTPUT_DIR/bios/bios-256k.bin" 200000 "BIOS ROM"
check_file "$OUTPUT_DIR/bios/vgabios-stdvga.bin" 30000 "VGA BIOS ROM"
check_file "$OUTPUT_DIR/bios/kvmvapic.bin" 1000 "KVM VAPIC ROM"
check_file "$OUTPUT_DIR/bios/linuxboot_dma.bin" 1000 "Linux boot DMA ROM"

echo ""

if [ "$PASS" = true ]; then
    echo "=== BUILD SUCCESS ==="
    echo ""
    echo "Artifacts in $OUTPUT_DIR:"
    ls -lh "$OUTPUT_DIR/"
    echo ""
    echo "BIOS files:"
    ls -lh "$OUTPUT_DIR/bios/"
else
    echo "=== BUILD FAILED — Some artifacts missing or invalid ==="
    exit 1
fi
