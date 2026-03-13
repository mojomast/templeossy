#!/usr/bin/env python3
"""Analyze PPM screenshot files from QEMU screendump.

Validates that screenshots are non-blank and contain at least 3 distinct colors,
which indicates TempleOS has booted and is rendering VGA output.

Also converts PPM files to PNG format for easier inspection.
"""

import os
import struct
import sys


def parse_ppm(filepath):
    """Parse a PPM (P6) file and return (width, height, pixels).

    pixels is a list of (r, g, b) tuples.
    """
    with open(filepath, "rb") as f:
        # Read magic number
        magic = f.readline().strip()
        if magic != b"P6":
            print(f"  WARNING: {filepath} is not P6 PPM format (got {magic})")
            return None, None, None

        # Skip comments
        line = f.readline()
        while line.startswith(b"#"):
            line = f.readline()

        # Read dimensions
        dims = line.strip().split()
        width, height = int(dims[0]), int(dims[1])

        # Read max color value
        maxval = int(f.readline().strip())

        # Read pixel data
        pixel_data = f.read()
        expected_size = width * height * 3
        if len(pixel_data) < expected_size:
            print(f"  WARNING: Pixel data truncated ({len(pixel_data)} < {expected_size})")
            return width, height, None

        pixels = []
        for i in range(0, expected_size, 3):
            r, g, b = pixel_data[i], pixel_data[i + 1], pixel_data[i + 2]
            pixels.append((r, g, b))

        return width, height, pixels


def write_png(filepath, width, height, pixels):
    """Write a minimal PNG file from pixel data.

    This is a basic PNG writer that doesn't require any external libraries.
    """
    import zlib

    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
        return struct.pack(">I", len(data)) + c + crc

    # PNG signature
    signature = b"\x89PNG\r\n\x1a\n"

    # IHDR
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    ihdr = chunk(b"IHDR", ihdr_data)

    # IDAT - raw pixel data with filter byte (0 = none) per row
    raw_data = b""
    for y in range(height):
        raw_data += b"\x00"  # filter byte
        for x in range(width):
            idx = y * width + x
            r, g, b = pixels[idx]
            raw_data += bytes([r, g, b])

    compressed = zlib.compress(raw_data)
    idat = chunk(b"IDAT", compressed)

    # IEND
    iend = chunk(b"IEND", b"")

    with open(filepath, "wb") as f:
        f.write(signature + ihdr + idat + iend)


def analyze_screenshot(filepath):
    """Analyze a single PPM screenshot file."""
    basename = os.path.basename(filepath)
    size = os.path.getsize(filepath)
    print(f"\n--- {basename} ({size} bytes) ---")

    width, height, pixels = parse_ppm(filepath)
    if pixels is None:
        print("  SKIP: Could not parse pixel data")
        return False

    print(f"  Dimensions: {width}x{height}")

    # Count distinct colors (sample every 10th pixel for speed)
    color_set = set()
    for i in range(0, len(pixels), 10):
        color_set.add(pixels[i])

    num_colors = len(color_set)
    print(f"  Distinct colors (sampled): {num_colors}")

    # Check if blank (all one color)
    is_blank = num_colors <= 1
    is_valid = num_colors >= 3

    if is_blank:
        print("  STATUS: BLANK (single color)")
    elif is_valid:
        print("  STATUS: VALID (3+ distinct colors)")
    else:
        print(f"  STATUS: NEAR-BLANK ({num_colors} colors)")

    # Show some sample colors
    sample_colors = list(color_set)[:10]
    print(f"  Sample colors: {sample_colors}")

    # Check for expected PPM size for 640x480
    expected_min_size = 640 * 480 * 3
    if size >= expected_min_size:
        print(f"  Size check: PASS (>= {expected_min_size} bytes)")
    else:
        print(f"  Size check: WARN (< {expected_min_size} bytes for 640x480)")

    # Convert to PNG
    png_path = filepath.replace(".ppm", ".png")
    try:
        write_png(png_path, width, height, pixels)
        png_size = os.path.getsize(png_path)
        print(f"  Converted to PNG: {os.path.basename(png_path)} ({png_size} bytes)")
    except Exception as e:
        print(f"  PNG conversion failed: {e}")

    return is_valid


def main():
    if len(sys.argv) < 2:
        print("Usage: analyze-ppm.py <directory>")
        sys.exit(1)

    output_dir = sys.argv[1]
    ppm_files = sorted(
        [f for f in os.listdir(output_dir) if f.endswith(".ppm")]
    )

    if not ppm_files:
        print("No PPM files found in", output_dir)
        sys.exit(1)

    print(f"Found {len(ppm_files)} PPM file(s) in {output_dir}")

    valid_count = 0
    for ppm_file in ppm_files:
        filepath = os.path.join(output_dir, ppm_file)
        if analyze_screenshot(filepath):
            valid_count += 1

    print(f"\n=== Summary: {valid_count}/{len(ppm_files)} screenshots are valid (3+ colors) ===")

    if valid_count == 0:
        print("FAIL: No valid screenshots captured. TempleOS may not have booted.")
        sys.exit(1)
    else:
        print("PASS: At least one valid screenshot shows TempleOS rendered VGA output.")
        sys.exit(0)


if __name__ == "__main__":
    main()
