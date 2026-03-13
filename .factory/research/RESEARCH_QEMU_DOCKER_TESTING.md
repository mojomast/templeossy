# QEMU Docker Testing Research Report

## Purpose
Validate that TempleOS boots under native QEMU before attempting the browser (WASM) port.
The host system does not have QEMU installed but has Docker available.

---

## 1. Docker Image Recommendation

### Option A: `qemux/qemu` (⭐ RECOMMENDED)
- **Docker Hub:** `docker.io/qemux/qemu` (1.7k GitHub stars, 200+ forks)
- **GitHub:** https://github.com/qemus/qemu
- **What it includes:** Full QEMU installation with web-based VNC viewer (noVNC on port 8006)
- **Key features:**
  - Supports custom ISOs via URL or volume mount (`-v ./my.iso:/boot.iso`)
  - Built-in VNC/noVNC web display — perfect for headless validation
  - Supports legacy BIOS boot (`BOOT_MODE=legacy`) — **critical for TempleOS**
  - Supports IDE disk emulation (`DISK_TYPE=ide`) — **critical for TempleOS** (no VirtIO drivers)
  - Configurable RAM and CPU (`RAM_SIZE`, `CPU_CORES`)
  - No KVM required (falls back to TCG emulation)
  - Actively maintained (last commit Dec 2025)

### Option B: Simple Debian/Ubuntu + QEMU (DIY)
Build a minimal Docker image with just `qemu-system-x86_64`:
```dockerfile
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    qemu-system-x86 qemu-utils netcat-openbsd && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
```
- **Pros:** Full control over QEMU flags and monitor
- **Cons:** Must implement all orchestration ourselves

### Option C: `jkz0/qemu`
- **GitHub:** https://github.com/joshkunz/qemu-docker
- **Docker Hub:** `jkz0/qemu`
- Simpler, but requires KVM (not suitable for environments without `/dev/kvm`)

### Recommendation
**Use Option A (`qemux/qemu`) for initial validation** — it handles the hard parts (display, disk management). For scripted headless testing with screenshot capture, **use Option B** with a custom Dockerfile for full monitor control.

---

## 2. QEMU Command Line for TempleOS

### Known Working Configurations

**From Linode Community (simple boot):**
```bash
qemu-system-x86_64 -boot d -cdrom TempleOS.ISO -m 1024
```

**From bubstance/templeos-plus (full config):**
```bash
qemu-system-x86_64 \
    -display gtk,zoom-to-fit=on \
    -rtc base=localtime \
    -enable-kvm \
    -m 2048 \
    -smp $(nproc) \
    -cdrom TempleOS.ISO \
    -hda templeos.img \
    -boot d
```

**Key findings from community:**
- Install mode: use `-cdrom TempleOS.ISO -hda disk.img -boot d`
- Run mode: use `-hda disk.img` only
- `-enable-kvm` optional (TCG works but slower)
- **No VirtIO support** — TempleOS lacks drivers. Must use IDE disk controller.
- 512 MiB RAM is absolute minimum; 1–2 GiB recommended
- TempleOS uses 640x480 VGA resolution (hardcoded as "divine resolution")
- `-rtc base=localtime` recommended for correct time

### TempleOS-Specific Hardware Requirements
| Component | Setting | Notes |
|-----------|---------|-------|
| Machine type | Default `pc` (i440FX) | Standard PC, **not** Q35 |
| CPU | Default or `-cpu qemu64` | x86_64 required |
| Display | `-vga std` (default) | Standard VGA BIOS needed |
| Disk controller | IDE (default) | **No VirtIO drivers in TempleOS** |
| Boot device | `-boot d` for CD-ROM | Standard BIOS boot |
| RAM | `-m 512` minimum, `-m 2048` recommended | |
| Network | Not needed | TempleOS has no networking |
| Audio | Optional (`-audiodev` + pcspk) | PC speaker support in TempleOS |

### Headless QEMU Command for Docker

```bash
qemu-system-x86_64 \
    -display none \
    -vnc :0 \
    -monitor telnet:0.0.0.0:4444,server,nowait \
    -rtc base=localtime \
    -m 2048 \
    -smp 2 \
    -cdrom /workspace/TempleOS.ISO \
    -hda /workspace/templeos.qcow2 \
    -boot d
```

**Flags explained:**
- `-display none` — No local display (headless)
- `-vnc :0` — Expose VNC server on port 5900 (for optional visual inspection)
- `-monitor telnet:0.0.0.0:4444,server,nowait` — Expose QEMU monitor via telnet for screendump commands
- `-boot d` — Boot from CD-ROM (the ISO)

---

## 3. Capturing VGA Output Headlessly

### Approach A: QEMU Monitor `screendump` Command (⭐ RECOMMENDED)

QEMU's built-in monitor supports the `screendump` command which captures the current VGA framebuffer to a PPM image file.

**Setup:**
```bash
# Start QEMU with telnet monitor
qemu-system-x86_64 \
    -display none \
    -monitor telnet:0.0.0.0:4444,server,nowait \
    -cdrom TempleOS.ISO -m 2048 -boot d
```

**Take a screenshot via telnet:**
```bash
# Using netcat to send screendump command
echo "screendump /workspace/screenshot.ppm" | nc localhost 4444
```

**Or using socat for more reliable operation:**
```bash
echo "screendump /workspace/screenshot.ppm" | socat - TCP:localhost:4444
```

**Automated screenshot loop:**
```bash
#!/bin/bash
# Wait for boot (30-60 seconds for TempleOS)
sleep 45

# Take screenshot
echo "screendump /workspace/screenshot.ppm" | nc -q1 localhost 4444

# Convert PPM to PNG (if ImageMagick available)
convert /workspace/screenshot.ppm /workspace/screenshot.png
```

**Output format:** PPM (Portable Pixmap) — can be viewed or converted to PNG.

### Approach B: QEMU Monitor via Unix Socket

```bash
qemu-system-x86_64 \
    -display none \
    -monitor unix:/tmp/qemu-monitor.sock,server,nowait \
    -cdrom TempleOS.ISO -m 2048 -boot d

# Take screenshot
echo "screendump /workspace/screenshot.ppm" | socat - UNIX-CONNECT:/tmp/qemu-monitor.sock
```

### Approach C: QEMU QMP (JSON-based Monitor Protocol)

```bash
qemu-system-x86_64 \
    -display none \
    -qmp tcp:0.0.0.0:4445,server,nowait \
    -cdrom TempleOS.ISO -m 2048 -boot d

# Take screenshot via QMP
echo '{"execute": "qmp_capabilities"}
{"execute": "screendump", "arguments": {"filename": "/workspace/screenshot.ppm"}}' | nc localhost 4445
```

### Approach D: VNC + vncsnapshot

```bash
# Start QEMU with VNC
qemu-system-x86_64 -display none -vnc :0 -cdrom TempleOS.ISO -m 2048 -boot d

# From another container/process, take VNC snapshot
vncsnapshot localhost:0 screenshot.jpg
```

---

## 4. TempleOS Serial Console Support

### Finding: TempleOS Has NO Serial Console Output

**TempleOS does NOT output anything to serial/COM ports.** It is purely VGA-based.

**Evidence:**
- TempleOS is designed exclusively for 640x480 VGA graphics mode
- The OS boots directly into graphical mode with its custom DolDoc interface
- There is no kernel console log, no text-mode boot messages to serial
- Terry Davis intentionally limited the scope: "640x480 is a divine covenant with God"
- The TempleOS kernel writes directly to VGA framebuffer, bypassing any serial/text output
- No UART/RS232 driver exists in TempleOS source code
- The boot process goes: BIOS → TempleOS bootloader → kernel → graphical shell (all VGA)

**Implications for headless testing:**
- `-serial stdio` will NOT produce any output
- `-nographic` will NOT work (TempleOS requires VGA)
- We MUST use VGA framebuffer capture (screendump) to verify boot
- There is no textual "boot complete" signal to detect programmatically

### TinkerOS (TempleOS Fork) Note
TinkerOS has a "mode 15" text-only display mode that works with `-display curses`, but this is a **fork-specific feature** not in standard TempleOS. Even TinkerOS doesn't output to serial.

---

## 5. Step-by-Step Phase 0 Validation Instructions

### Prerequisites
- Docker installed on host
- TempleOS ISO available (download from archive.org or GitHub)

### Step 1: Download the TempleOS ISO

```bash
cd /home/mojo/projects/templeossy

# Download from archive.org (~17 MB)
wget -O TempleOS.ISO "https://archive.org/download/TempleOS_ISO_Archive/TempleOSCDV5.03.ISO"

# Verify size (should be 17,817,600 bytes / ~17 MB)
ls -la TempleOS.ISO
```

### Step 2: Create a Dockerfile for Headless QEMU Testing

```dockerfile
# Dockerfile.qemu-test
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    qemu-system-x86 \
    qemu-utils \
    netcat-openbsd \
    imagemagick \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Copy the ISO into the container
COPY TempleOS.ISO /workspace/TempleOS.ISO

# Create a disk image for installation
RUN qemu-img create -f qcow2 /workspace/templeos.qcow2 512M

# Script to boot and capture screenshot
COPY boot-test.sh /workspace/boot-test.sh
RUN chmod +x /workspace/boot-test.sh

CMD ["/workspace/boot-test.sh"]
```

### Step 3: Create the Boot Test Script

```bash
#!/bin/bash
# boot-test.sh — Boot TempleOS headlessly and capture a screenshot

set -e

echo "=== Starting TempleOS QEMU Boot Test ==="
echo "Starting QEMU in background with telnet monitor..."

# Start QEMU headlessly with telnet monitor
qemu-system-x86_64 \
    -display none \
    -monitor telnet:0.0.0.0:4444,server,nowait \
    -rtc base=localtime \
    -m 2048 \
    -smp 2 \
    -cdrom /workspace/TempleOS.ISO \
    -hda /workspace/templeos.qcow2 \
    -boot d \
    -no-reboot \
    &

QEMU_PID=$!
echo "QEMU started with PID: $QEMU_PID"

# Wait for QEMU to start
sleep 5

# Function to take screenshot
take_screenshot() {
    local name=$1
    echo "Taking screenshot: ${name}..."
    echo "screendump /workspace/${name}.ppm" | nc -q1 localhost 4444 || true
    sleep 1
    if [ -f "/workspace/${name}.ppm" ]; then
        # Convert PPM to PNG
        convert "/workspace/${name}.ppm" "/workspace/${name}.png" 2>/dev/null || true
        echo "Screenshot saved: /workspace/${name}.ppm"
        # Get file size as a basic check
        ls -la "/workspace/${name}.ppm"
    else
        echo "WARNING: Screenshot ${name}.ppm was not created"
    fi
}

# Take screenshots at various stages of boot
echo "Waiting 10s for BIOS/early boot..."
sleep 10
take_screenshot "boot_01_bios"

echo "Waiting 20s more for TempleOS bootloader..."
sleep 20
take_screenshot "boot_02_bootloader"

echo "Waiting 30s more for TempleOS desktop..."
sleep 30
take_screenshot "boot_03_desktop"

echo "Waiting 30s more for fully loaded state..."
sleep 30
take_screenshot "boot_04_loaded"

# Check if QEMU is still running (indicates OS booted without crashing)
if kill -0 $QEMU_PID 2>/dev/null; then
    echo "=== SUCCESS: QEMU is still running (TempleOS likely booted) ==="
    
    # Take one final screenshot
    take_screenshot "boot_05_final"
    
    # Gracefully shutdown
    echo "Sending quit command to QEMU..."
    echo "quit" | nc -q1 localhost 4444 || true
    wait $QEMU_PID 2>/dev/null || true
else
    echo "=== WARNING: QEMU exited (TempleOS may have crashed or rebooted) ==="
    echo "Exit code: $?"
fi

echo ""
echo "=== Boot Test Complete ==="
echo "Screenshots saved in /workspace/"
ls -la /workspace/*.ppm /workspace/*.png 2>/dev/null || echo "No screenshots found"
```

### Step 4: Build and Run

```bash
# Build the Docker image
docker build -f Dockerfile.qemu-test -t templeos-boot-test .

# Run the test (mount output directory to get screenshots)
docker run --rm -v $(pwd)/output:/workspace/output templeos-boot-test

# Or run interactively to debug
docker run --rm -it -p 4444:4444 templeos-boot-test bash
```

### Step 5: Alternative — Using `qemux/qemu` Image

```bash
# Quick test using qemux/qemu with noVNC web viewer
docker run -it --rm \
    -e BOOT_MODE=legacy \
    -e DISK_TYPE=ide \
    -e RAM_SIZE=2G \
    -e CPU_CORES=2 \
    -p 8006:8006 \
    -v $(pwd)/TempleOS.ISO:/boot.iso \
    qemux/qemu

# Then open http://localhost:8006 in a browser to see the TempleOS display
```

**Note:** The `qemux/qemu` approach requires a browser to view the noVNC display, so it's semi-headless (you need browser access to port 8006 to visually verify). For fully automated headless validation with screenshot capture, use the custom Dockerfile approach.

---

## 6. Verification Strategy (What "Boot Success" Looks Like)

Since TempleOS has no serial output, we must verify boot via VGA screenshots:

### Expected Boot Sequence
1. **BIOS screen** (SeaBIOS banner) — ~2-5 seconds
2. **TempleOS bootloader** — text menu asking which drive to boot from — ~5-10 seconds
3. **TempleOS kernel loading** — brief black screen or loading text — ~10-30 seconds  
4. **TempleOS desktop** — colorful text-mode GUI with DolDoc interface, "Welcome to TempleOS" — ~30-90 seconds (without KVM, may take longer with TCG)

### Automated Verification Ideas
- **File size check:** A valid PPM screenshot at 640x480 should be exactly `640 * 480 * 3 + PPM_header ≈ 921,615+ bytes`
- **Non-blank check:** If the screenshot is all zeros/black, the display may not be initialized
- **PPM pixel analysis:** Parse PPM file and check if it contains non-trivial pixel data (not all one color)
- **Compare against known screenshots:** Store a reference TempleOS desktop screenshot and do image diff

### Boot Timing Expectations (Without KVM)
Without KVM acceleration (pure TCG), boot may take **2-5 minutes** instead of seconds. Be patient with the wait times in the test script.

---

## 7. Important Notes and Caveats

### No KVM in Docker (Typically)
- Most Docker environments do NOT pass through `/dev/kvm`
- QEMU will fall back to software emulation (TCG) — much slower but functional
- If the host does support KVM and Docker can access it: `docker run --device=/dev/kvm ...`
- For validation purposes, TCG is sufficient

### TempleOS Bootloader Interaction
- The TempleOS ISO bootloader may prompt: "Install which drive?" 
- In headless mode, you may need to send keystrokes via the QEMU monitor
- `sendkey` QEMU monitor command can simulate keypresses:
  ```
  echo "sendkey ret" | nc -q1 localhost 4444
  ```
- Alternatively, boot from a pre-installed disk image (avoid the installer prompts)

### Disk Image vs ISO Boot
- **ISO boot (live):** Boots into TempleOS installer/live environment. May require keyboard interaction.
- **Pre-installed image:** Create a disk image with TempleOS already installed (via interactive session first), then use that for automated headless testing.

### PPM Image Format
- QEMU `screendump` produces PPM (Portable Pixmap) format
- Simple ASCII header followed by RGB pixel data
- Can be converted to PNG with ImageMagick: `convert input.ppm output.png`
- Can be viewed directly with many image viewers

---

## 8. Summary

| Question | Answer |
|----------|--------|
| **Docker image for QEMU** | `qemux/qemu` for quick visual test, custom Debian image for scripted testing |
| **QEMU command for TempleOS** | `qemu-system-x86_64 -display none -monitor telnet:0.0.0.0:4444,server,nowait -rtc base=localtime -m 2048 -cdrom TempleOS.ISO -boot d` |
| **VGA capture approach** | `screendump` via QEMU monitor (telnet or unix socket) → PPM file |
| **TempleOS serial output?** | **NO** — TempleOS has zero serial console support, VGA framebuffer only |
| **Validation method** | Timed screenshot capture + PPM file analysis (non-blank, correct size) |
| **Boot time without KVM** | 2-5 minutes (TCG emulation) |
| **Key requirement** | Must use IDE disk (no VirtIO), legacy BIOS boot, 640x480 VGA |
