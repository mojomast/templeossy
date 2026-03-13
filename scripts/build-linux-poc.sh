#!/bin/bash
# build-linux-poc.sh — Build a minimal Linux kernel + busybox initramfs for the display PoC.
#
# Extracts vmlinuz and creates a small initramfs from Alpine Linux.
# Output goes to public/linux-poc/ for serving via Vite dev server.
#
# Usage: ./scripts/build-linux-poc.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$PROJECT_ROOT/public/linux-poc"

echo "=== Building Linux PoC Kernel + Initramfs ==="

mkdir -p "$OUTPUT_DIR"

# Use Alpine Linux's virtual kernel — it's tiny and boots fast in QEMU.
# We extract vmlinuz-virt and build a minimal initramfs with busybox.
docker run --rm \
  -v "$OUTPUT_DIR:/output" \
  alpine:3.21 \
  sh -c '
    set -e
    echo "=== Installing kernel and busybox ==="
    apk add --no-cache linux-virt busybox-static

    echo "=== Copying kernel ==="
    cp /boot/vmlinuz-virt /output/vmlinuz

    echo "=== Building initramfs ==="
    INITRAMFS_DIR=$(mktemp -d)
    mkdir -p "$INITRAMFS_DIR/bin" "$INITRAMFS_DIR/sbin" "$INITRAMFS_DIR/etc" \
      "$INITRAMFS_DIR/proc" "$INITRAMFS_DIR/sys" "$INITRAMFS_DIR/dev" \
      "$INITRAMFS_DIR/tmp" "$INITRAMFS_DIR/usr/bin" "$INITRAMFS_DIR/usr/sbin"

    # Use statically-linked busybox
    cp /bin/busybox.static "$INITRAMFS_DIR/bin/busybox"

    # Create busybox symlinks
    cd "$INITRAMFS_DIR/bin"
    for cmd in sh ash ls cat echo mount mkdir mknod sleep clear login \
               grep sed awk head tail uname dmesg ps free df du \
               cp mv rm ln chmod chown mkdir rmdir pwd date id \
               vi hostname ifconfig ping ip; do
      ln -sf busybox "$cmd"
    done

    cd "$INITRAMFS_DIR/sbin"
    for cmd in init halt reboot poweroff; do
      ln -sf ../bin/busybox "$cmd"
    done

    # Create init script
    cat > "$INITRAMFS_DIR/init" << "INITEOF"
#!/bin/sh
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev

# Set up console
exec 0</dev/console
exec 1>/dev/console
exec 2>/dev/console

echo ""
echo "============================================"
echo "  Linux PoC - TempleOS Browser Project"
echo "  Display pipeline verification"
echo "============================================"
echo ""
echo "Kernel: $(uname -r)"
echo "Architecture: $(uname -m)"
echo ""
echo "If you can see this text on the canvas,"
echo "the display rendering pipeline is working!"
echo ""

# Drop to shell
exec /bin/sh
INITEOF
    chmod +x "$INITRAMFS_DIR/init"

    # Pack initramfs
    cd "$INITRAMFS_DIR"
    find . | cpio -H newc -o | gzip > /output/initramfs.gz

    echo "=== Done ==="
    ls -lh /output/
  '

echo ""
echo "=== Linux PoC files ==="
ls -lh "$OUTPUT_DIR/"
echo ""
echo "Total size:"
du -sh "$OUTPUT_DIR/"
