# Native QEMU Validation — TempleOS V5.03

## Summary

TempleOS V5.03 successfully boots under native QEMU (x86_64 TCG emulation) inside Docker.
The OS reaches its full desktop/installer environment within ~15 seconds under TCG.

**TempleOS has NO serial output.** VGA screendump via the QEMU monitor is the only
verification method for headless testing.

## Working QEMU Flags

```bash
qemu-system-x86_64 \
    -display none \
    -monitor telnet:0.0.0.0:4444,server,nowait \
    -m 2048 \
    -smp 1 \
    -cdrom TempleOS.ISO \
    -boot d \
    -rtc base=localtime \
    -no-reboot
```

### Flag Explanation

| Flag | Purpose |
|------|---------|
| `-display none` | Headless mode — no local display window |
| `-monitor telnet:0.0.0.0:4444,server,nowait` | QEMU monitor accessible via telnet for screendump commands |
| `-m 2048` | 2048 MB RAM (recommended; TempleOS minimum is 512 MB) |
| `-smp 1` | Single CPU core (TempleOS supports SMP but 1 is sufficient) |
| `-cdrom TempleOS.ISO` | Boot from TempleOS V5.03 ISO |
| `-boot d` | Boot from CD-ROM drive |
| `-rtc base=localtime` | Use host's local time for RTC (recommended for TempleOS) |
| `-no-reboot` | Prevent automatic reboot on crash (aids debugging) |

### Hardware Requirements for TempleOS

| Component | Setting | Notes |
|-----------|---------|-------|
| Machine type | Default `pc` (i440FX) | Standard PC — **not** Q35 |
| CPU | Default `qemu64` | x86_64 required (TempleOS is 64-bit only) |
| Display | Standard VGA (`-vga std`, default) | 640×480 fixed resolution |
| Disk controller | IDE (default) | **No VirtIO** — TempleOS lacks drivers |
| Boot device | `-boot d` for CD-ROM | Standard BIOS boot (not UEFI) |
| RAM | `-m 512` minimum, `-m 2048` recommended | |
| Network | Not needed | TempleOS has no networking |

## Screenshot Capture Method

TempleOS provides no serial console, text output, or other programmatic boot signal.
The **only** way to verify boot in headless mode is VGA framebuffer capture via the
QEMU monitor `screendump` command.

### Capture via Telnet

```bash
# Send screendump command to QEMU monitor
printf "screendump /path/to/screenshot.ppm\n" | nc -q1 -w2 localhost 4444
```

### Output Format

- **PPM (P6)** — Portable Pixmap format
- **640×480 resolution** — TempleOS "divine resolution"
- **File size:** 921,615 bytes (640 × 480 × 3 + 15-byte header)
- Can be converted to PNG with Python (see `build/analyze-ppm.py`)

## Docker Setup

### Dockerfile

Located at `build/Dockerfile.qemu-test`:

```dockerfile
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    qemu-system-x86 qemu-utils netcat-openbsd python3 \
    && rm -rf /var/lib/apt/lists/*
```

### Build and Run

```bash
# Build Docker image
docker build -f build/Dockerfile.qemu-test -t templeos-qemu-test build/

# Run boot test (mounts ISO and collects screenshots)
docker run --rm \
    -v "$(pwd)/assets/TempleOSCDV5.03.ISO:/workspace/TempleOS.ISO:ro" \
    -v "$(pwd)/output:/workspace/output" \
    templeos-qemu-test
```

## Boot Sequence

The following stages were observed during validation:

1. **BIOS (SeaBIOS)** — ~1-2 seconds
2. **TempleOS bootloader** — immediately after BIOS
3. **TempleOS desktop** — boots to full desktop within ~15 seconds under TCG

At ~15 seconds, TempleOS displays:
- Two windows (left and right panes)
- "Public Domain Operating System" header
- "Install onto hard drive (y or n)?" prompt
- System Keys Quick Guide popup
- FPS counter and memory info in status bar

## Validation Results

| Checkpoint | Result |
|------------|--------|
| ISO size correct (17,817,600 bytes) | ✅ PASS |
| QEMU runs ≥ 90 seconds without crash | ✅ PASS |
| Screenshots captured at 5 boot stages | ✅ PASS (5/5) |
| All screenshots 640×480 PPM (921,615 bytes) | ✅ PASS |
| Screenshots contain ≥ 3 distinct colors | ✅ PASS (9-10 colors each) |
| TempleOS desktop visible | ✅ PASS |

## Reference Screenshot

The final boot screenshot is saved at:
- **PNG:** `docs/screenshots/native-qemu-boot.png`
- **PPM:** `docs/screenshots/native-qemu-boot.ppm`

## TempleOS ISO

- **File:** `assets/TempleOSCDV5.03.ISO`
- **Size:** 17,817,600 bytes (exactly 17.0 MB)
- **Version:** V5.03 (initial release)
- **License:** Public Domain
- **Source:** [archive.org](https://archive.org/download/TempleOS_ISO_Archive/TempleOSCDV5.03.ISO)
