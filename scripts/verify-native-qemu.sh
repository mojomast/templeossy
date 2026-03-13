#!/bin/bash
# verify-native-qemu.sh — Verify native QEMU validation artifacts
# Checks that TempleOS ISO and boot screenshots exist and are valid.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXIT_CODE=0

check() {
    local desc="$1"
    local result="$2"
    if [ "$result" = "PASS" ]; then
        echo "  ✅ $desc"
    else
        echo "  ❌ $desc"
        EXIT_CODE=1
    fi
}

echo "=== Native QEMU Validation Check ==="
echo ""

# Check ISO exists and is correct size
ISO_PATH="$REPO_ROOT/assets/TempleOSCDV5.03.ISO"
if [ -f "$ISO_PATH" ]; then
    ISO_SIZE=$(stat -c%s "$ISO_PATH" 2>/dev/null || stat -f%z "$ISO_PATH" 2>/dev/null)
    if [ "$ISO_SIZE" = "17817600" ]; then
        check "TempleOS ISO exists (17,817,600 bytes)" "PASS"
    else
        check "TempleOS ISO size ($ISO_SIZE != 17817600)" "FAIL"
    fi
else
    check "TempleOS ISO exists" "FAIL"
fi

# Check reference screenshot exists
SCREENSHOT_PNG="$REPO_ROOT/docs/screenshots/native-qemu-boot.png"
if [ -f "$SCREENSHOT_PNG" ]; then
    PNG_SIZE=$(stat -c%s "$SCREENSHOT_PNG" 2>/dev/null || stat -f%z "$SCREENSHOT_PNG" 2>/dev/null)
    if [ "$PNG_SIZE" -gt 1000 ]; then
        check "Reference screenshot PNG exists (${PNG_SIZE} bytes)" "PASS"
    else
        check "Reference screenshot PNG too small (${PNG_SIZE} bytes)" "FAIL"
    fi
else
    check "Reference screenshot PNG exists" "FAIL"
fi

SCREENSHOT_PPM="$REPO_ROOT/docs/screenshots/native-qemu-boot.ppm"
if [ -f "$SCREENSHOT_PPM" ]; then
    PPM_SIZE=$(stat -c%s "$SCREENSHOT_PPM" 2>/dev/null || stat -f%z "$SCREENSHOT_PPM" 2>/dev/null)
    if [ "$PPM_SIZE" -ge 921600 ]; then
        check "Reference screenshot PPM exists (${PPM_SIZE} bytes, >= 921600)" "PASS"
    else
        check "Reference screenshot PPM too small (${PPM_SIZE} bytes)" "FAIL"
    fi
else
    check "Reference screenshot PPM exists" "FAIL"
fi

# Check documentation exists
DOC_PATH="$REPO_ROOT/docs/native-qemu-validation.md"
if [ -f "$DOC_PATH" ]; then
    check "Documentation exists (docs/native-qemu-validation.md)" "PASS"
else
    check "Documentation exists" "FAIL"
fi

# Check Docker build files exist
if [ -f "$REPO_ROOT/build/Dockerfile.qemu-test" ]; then
    check "Dockerfile.qemu-test exists" "PASS"
else
    check "Dockerfile.qemu-test exists" "FAIL"
fi

if [ -f "$REPO_ROOT/build/boot-test.sh" ]; then
    check "boot-test.sh exists" "PASS"
else
    check "boot-test.sh exists" "FAIL"
fi

if [ -f "$REPO_ROOT/build/analyze-ppm.py" ]; then
    check "analyze-ppm.py exists" "PASS"
else
    check "analyze-ppm.py exists" "FAIL"
fi

echo ""
if [ "$EXIT_CODE" = "0" ]; then
    echo "=== All checks passed ==="
else
    echo "=== Some checks failed ==="
fi

exit $EXIT_CODE
