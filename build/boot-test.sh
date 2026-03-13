#!/bin/bash
# boot-test.sh — Boot TempleOS headlessly under native QEMU and capture VGA screenshots
# This script validates that TempleOS boots under QEMU with TCG emulation.
# TempleOS has NO serial output — VGA screendump is the only verification method.

set -e

ISO_PATH="/workspace/TempleOS.ISO"
OUTPUT_DIR="/workspace/output"
MONITOR_PORT=4444
QEMU_RAM="2048"
QEMU_SMP="1"
BOOT_WAIT=90

mkdir -p "$OUTPUT_DIR"

if [ ! -f "$ISO_PATH" ]; then
    echo "ERROR: TempleOS ISO not found at $ISO_PATH"
    exit 1
fi

echo "=== TempleOS Native QEMU Boot Validation ==="
echo "ISO: $ISO_PATH ($(stat -c%s "$ISO_PATH") bytes)"
echo "RAM: ${QEMU_RAM}MB, SMP: ${QEMU_SMP}"
echo ""

# QEMU flags — documented as the working configuration for TempleOS
QEMU_FLAGS=(
    -display none
    -monitor "telnet:0.0.0.0:${MONITOR_PORT},server,nowait"
    -m "$QEMU_RAM"
    -smp "$QEMU_SMP"
    -cdrom "$ISO_PATH"
    -boot d
    -rtc base=localtime
    -no-reboot
)

echo "QEMU flags: ${QEMU_FLAGS[*]}"
echo ""
echo "Starting QEMU..."

qemu-system-x86_64 "${QEMU_FLAGS[@]}" &
QEMU_PID=$!
echo "QEMU started with PID: $QEMU_PID"

# Wait for QEMU monitor to be available
echo "Waiting for QEMU monitor on port $MONITOR_PORT..."
for i in $(seq 1 30); do
    if echo "" | nc -q1 -w1 localhost "$MONITOR_PORT" 2>/dev/null; then
        echo "Monitor connected after ${i}s"
        break
    fi
    sleep 1
done

# Function to take a screenshot via QEMU monitor screendump command
take_screenshot() {
    local name=$1
    local ppm_path="${OUTPUT_DIR}/${name}.ppm"
    echo "Taking screenshot: ${name}..."
    printf "screendump %s\n" "$ppm_path" | nc -q1 -w2 localhost "$MONITOR_PORT" 2>/dev/null || true
    sleep 2
    if [ -f "$ppm_path" ]; then
        local size
        size=$(stat -c%s "$ppm_path")
        echo "  -> ${name}.ppm saved (${size} bytes)"
    else
        echo "  -> WARNING: ${name}.ppm was not created"
    fi
}

# Take screenshots at various boot stages
echo ""
echo "=== Capturing boot sequence screenshots ==="

echo "Waiting 15s for BIOS..."
sleep 15
take_screenshot "boot_01_bios"

echo "Waiting 15s for bootloader..."
sleep 15
take_screenshot "boot_02_bootloader"

echo "Waiting 30s for kernel loading..."
sleep 30
take_screenshot "boot_03_kernel"

echo "Waiting 30s for desktop/installer..."
sleep 30
take_screenshot "boot_04_desktop"

# Check if QEMU is still running
if kill -0 "$QEMU_PID" 2>/dev/null; then
    echo ""
    echo "=== QEMU still running after ${BOOT_WAIT}s — TempleOS likely booted ==="
    take_screenshot "boot_05_final"
else
    echo ""
    echo "=== WARNING: QEMU exited prematurely ==="
    echo "This may indicate a boot failure or reboot loop."
fi

# Analyze screenshots using Python
echo ""
echo "=== Analyzing screenshots ==="
python3 /workspace/analyze-ppm.py "$OUTPUT_DIR"

# Gracefully shutdown QEMU
echo ""
echo "Shutting down QEMU..."
if kill -0 "$QEMU_PID" 2>/dev/null; then
    printf "quit\n" | nc -q1 -w2 localhost "$MONITOR_PORT" 2>/dev/null || true
    sleep 2
    kill "$QEMU_PID" 2>/dev/null || true
    wait "$QEMU_PID" 2>/dev/null || true
fi

echo ""
echo "=== Boot Test Complete ==="
echo "Screenshots in $OUTPUT_DIR:"
ls -la "$OUTPUT_DIR"/*.ppm 2>/dev/null || echo "No PPM files found"
