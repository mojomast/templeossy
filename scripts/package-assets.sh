#!/bin/bash
# package-assets.sh — Package BIOS/ROM files and Shrine ISO for browser delivery
#
# Uses Emscripten's file_packager.py (via Docker) to create a preloaded data file
# (.data + load.js) that bundles all assets QEMU needs at runtime.
#
# BIOS files are placed at /pack/ (used with QEMU -L /pack flag)
# ISO is placed at /pack/Shrine-v5051.iso (used with QEMU -cdrom flag)
#
# Usage: ./scripts/package-assets.sh
#
# Prerequisites:
#   - Docker with qemu-wasm-builder image built
#   - BIOS files in build/output/bios/
#   - Shrine ISO in assets/Shrine-v5051.iso

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_OUTPUT="$PROJECT_ROOT/build/output"
PUBLIC_EMULATOR="$PROJECT_ROOT/public/emulator"
DOCKER_IMAGE="qemu-wasm-builder"

echo "=== Asset Packaging Pipeline ==="
echo "Project root: $PROJECT_ROOT"
echo ""

# Step 0: Verify prerequisites
echo "=== Checking prerequisites ==="

check_file() {
    local file="$1"
    local desc="$2"
    if [ ! -f "$file" ]; then
        echo "FAIL: $desc — file missing: $file"
        exit 1
    fi
    echo "OK: $desc — $(stat -c%s "$file") bytes"
}

check_file "$BUILD_OUTPUT/bios/bios-256k.bin" "BIOS ROM"
check_file "$BUILD_OUTPUT/bios/vgabios-stdvga.bin" "VGA BIOS ROM"
check_file "$BUILD_OUTPUT/bios/kvmvapic.bin" "KVM VAPIC ROM"
check_file "$BUILD_OUTPUT/bios/linuxboot_dma.bin" "Linux boot DMA ROM"
check_file "$PROJECT_ROOT/assets/Shrine-v5051.iso" "Shrine ISO"

echo ""
echo "=== Packaging assets with file_packager.py ==="

# Create a temporary staging directory inside the Docker context
STAGING_DIR=$(mktemp -d)
trap "rm -rf $STAGING_DIR" EXIT

# Create the /pack directory structure that QEMU will expect
mkdir -p "$STAGING_DIR/pack"

# Copy BIOS files (QEMU -L /pack will look here)
cp "$BUILD_OUTPUT/bios/bios-256k.bin" "$STAGING_DIR/pack/"
cp "$BUILD_OUTPUT/bios/vgabios-stdvga.bin" "$STAGING_DIR/pack/"
cp "$BUILD_OUTPUT/bios/kvmvapic.bin" "$STAGING_DIR/pack/"
cp "$BUILD_OUTPUT/bios/linuxboot_dma.bin" "$STAGING_DIR/pack/"

# Copy Shrine ISO (QEMU -cdrom /pack/Shrine-v5051.iso)
cp "$PROJECT_ROOT/assets/Shrine-v5051.iso" "$STAGING_DIR/pack/"

echo "Staging directory contents:"
ls -lh "$STAGING_DIR/pack/"
echo ""

# Run file_packager.py inside Docker
# --lz4: enable LZ4 compression (reduces .data file size for the ISO)
# --preload: embed files at specified virtual paths
# --js-output: generate the loader JS
docker run --rm \
    -v "$STAGING_DIR:/staging:ro" \
    -v "$PUBLIC_EMULATOR:/out" \
    "$DOCKER_IMAGE" \
    bash -c '
        cd /staging && \
        python3 /emsdk/upstream/emscripten/tools/file_packager.py \
            /out/qemu-system-x86_64.data \
            --preload pack/bios-256k.bin@/pack/bios-256k.bin \
            --preload pack/vgabios-stdvga.bin@/pack/vgabios-stdvga.bin \
            --preload pack/kvmvapic.bin@/pack/kvmvapic.bin \
            --preload pack/linuxboot_dma.bin@/pack/linuxboot_dma.bin \
            --preload pack/Shrine-v5051.iso@/pack/Shrine-v5051.iso \
            --js-output=/out/load.js \
            --no-node
    '

echo ""
echo "=== Packaging complete ==="
echo ""
echo "Generated files:"
ls -lh "$PUBLIC_EMULATOR/qemu-system-x86_64.data" "$PUBLIC_EMULATOR/load.js"

echo ""
echo "=== All public/emulator/ files ==="
ls -lh "$PUBLIC_EMULATOR/"
