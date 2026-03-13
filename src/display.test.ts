/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  convertBGRXtoRGBA,
  isNonBlankFrame,
  DisplayRenderer,
  type QemuModule,
} from './display';

describe('convertBGRXtoRGBA', () => {
  it('converts a single BGRX pixel to RGBA', () => {
    // BGRX: Blue=0xFF, Green=0x00, Red=0x00, X=0x00
    const bgrx = new Uint8ClampedArray([0xFF, 0x00, 0x00, 0x00]);
    const rgba = convertBGRXtoRGBA(bgrx, 1, 1);
    // RGBA: Red=0x00, Green=0x00, Blue=0xFF, Alpha=0xFF
    expect(rgba[0]).toBe(0x00); // R (was B position byte 2)
    expect(rgba[1]).toBe(0x00); // G (unchanged)
    expect(rgba[2]).toBe(0xFF); // B (was R position byte 0)
    expect(rgba[3]).toBe(0xFF); // A (set to 255)
  });

  it('converts pure red BGRX to RGBA correctly', () => {
    // BGRX: Blue=0x00, Green=0x00, Red=0xFF, X=0x00
    const bgrx = new Uint8ClampedArray([0x00, 0x00, 0xFF, 0x00]);
    const rgba = convertBGRXtoRGBA(bgrx, 1, 1);
    expect(rgba[0]).toBe(0xFF); // R
    expect(rgba[1]).toBe(0x00); // G
    expect(rgba[2]).toBe(0x00); // B
    expect(rgba[3]).toBe(0xFF); // A
  });

  it('converts pure green BGRX to RGBA correctly', () => {
    // BGRX: Blue=0x00, Green=0xFF, Red=0x00, X=0x00
    const bgrx = new Uint8ClampedArray([0x00, 0xFF, 0x00, 0x00]);
    const rgba = convertBGRXtoRGBA(bgrx, 1, 1);
    expect(rgba[0]).toBe(0x00); // R
    expect(rgba[1]).toBe(0xFF); // G
    expect(rgba[2]).toBe(0x00); // B
    expect(rgba[3]).toBe(0xFF); // A
  });

  it('converts multiple pixels correctly', () => {
    // 2x1 image: first pixel red in BGRX, second pixel blue in BGRX
    const bgrx = new Uint8ClampedArray([
      0x00, 0x00, 0xFF, 0x00, // BGRX red pixel
      0xFF, 0x00, 0x00, 0x00, // BGRX blue pixel
    ]);
    const rgba = convertBGRXtoRGBA(bgrx, 2, 1);
    // First pixel: Red
    expect(rgba[0]).toBe(0xFF);
    expect(rgba[1]).toBe(0x00);
    expect(rgba[2]).toBe(0x00);
    expect(rgba[3]).toBe(0xFF);
    // Second pixel: Blue
    expect(rgba[4]).toBe(0x00);
    expect(rgba[5]).toBe(0x00);
    expect(rgba[6]).toBe(0xFF);
    expect(rgba[7]).toBe(0xFF);
  });

  it('handles mixed color BGRX pixels', () => {
    // BGRX: B=128, G=64, R=32, X=0
    const bgrx = new Uint8ClampedArray([128, 64, 32, 0]);
    const rgba = convertBGRXtoRGBA(bgrx, 1, 1);
    expect(rgba[0]).toBe(32);  // R (was byte 2)
    expect(rgba[1]).toBe(64);  // G (unchanged)
    expect(rgba[2]).toBe(128); // B (was byte 0)
    expect(rgba[3]).toBe(0xFF); // A
  });

  it('always sets alpha to 255 regardless of X byte', () => {
    const bgrx = new Uint8ClampedArray([0, 0, 0, 0xAB]);
    const rgba = convertBGRXtoRGBA(bgrx, 1, 1);
    expect(rgba[3]).toBe(0xFF);
  });

  it('handles a 2x2 image', () => {
    const bgrx = new Uint8ClampedArray(4 * 4); // 2x2 = 4 pixels
    // Fill with different colors
    bgrx.set([0xFF, 0x00, 0x00, 0x00], 0);  // blue
    bgrx.set([0x00, 0xFF, 0x00, 0x00], 4);  // green
    bgrx.set([0x00, 0x00, 0xFF, 0x00], 8);  // red
    bgrx.set([0xFF, 0xFF, 0xFF, 0x00], 12); // white
    const rgba = convertBGRXtoRGBA(bgrx, 2, 2);
    expect(rgba.length).toBe(16);
    // Check white pixel (last)
    expect(rgba[12]).toBe(0xFF); // R
    expect(rgba[13]).toBe(0xFF); // G
    expect(rgba[14]).toBe(0xFF); // B
    expect(rgba[15]).toBe(0xFF); // A
  });
});

describe('isNonBlankFrame', () => {
  it('returns false for an all-black frame', () => {
    const pixels = new Uint8ClampedArray(4 * 100); // 100 pixels, all 0s
    // Set alpha to 255 for each pixel
    for (let i = 3; i < pixels.length; i += 4) {
      pixels[i] = 0xFF;
    }
    expect(isNonBlankFrame(pixels)).toBe(false);
  });

  it('returns false for an all-white frame', () => {
    const pixels = new Uint8ClampedArray(4 * 100);
    pixels.fill(0xFF);
    expect(isNonBlankFrame(pixels)).toBe(false);
  });

  it('returns true for a frame with exactly 2 colors', () => {
    const pixels = new Uint8ClampedArray(4 * 100);
    // 50 black pixels, 50 white pixels
    for (let i = 0; i < 50; i++) {
      pixels.set([0, 0, 0, 255], i * 4);
    }
    for (let i = 50; i < 100; i++) {
      pixels.set([255, 255, 255, 255], i * 4);
    }
    expect(isNonBlankFrame(pixels)).toBe(true);
  });

  it('returns true for a frame with more than 2 distinct colors', () => {
    const pixels = new Uint8ClampedArray(4 * 100);
    // 3 distinct colors
    for (let i = 0; i < 33; i++) {
      pixels.set([255, 0, 0, 255], i * 4);
    }
    for (let i = 33; i < 66; i++) {
      pixels.set([0, 255, 0, 255], i * 4);
    }
    for (let i = 66; i < 100; i++) {
      pixels.set([0, 0, 255, 255], i * 4);
    }
    expect(isNonBlankFrame(pixels)).toBe(true);
  });

  it('returns true for a typical VGA text-mode frame', () => {
    const pixels = new Uint8ClampedArray(4 * 100);
    // Mix of several different colors
    pixels.set([0, 0, 0, 255], 0);       // black
    pixels.set([255, 255, 255, 255], 4);  // white
    pixels.set([0, 0, 170, 255], 8);      // VGA blue
    pixels.set([170, 170, 170, 255], 12); // light gray
    expect(isNonBlankFrame(pixels)).toBe(true);
  });

  it('handles empty/zero-length pixel data', () => {
    const pixels = new Uint8ClampedArray(0);
    expect(isNonBlankFrame(pixels)).toBe(false);
  });
});

describe('DisplayRenderer', () => {
  let canvas: HTMLCanvasElement;
  let mockModule: QemuModule;
  let renderer: DisplayRenderer;
  let mockCtx: Record<string, unknown>;
  const originalImageData = globalThis.ImageData;

  beforeEach(() => {
    // Create a canvas element and mock getContext since jsdom doesn't implement it
    canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;

    mockCtx = {
      putImageData: vi.fn(),
      getImageData: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
    };

    // Mock getContext to return our mock context
    vi.spyOn(canvas, 'getContext').mockReturnValue(mockCtx as unknown as CanvasRenderingContext2D);

    // Mock QEMU Module
    mockModule = {
      _qemu_display_data: vi.fn().mockReturnValue(0),
      _qemu_display_width: vi.fn().mockReturnValue(0),
      _qemu_display_height: vi.fn().mockReturnValue(0),
      _qemu_display_stride: vi.fn().mockReturnValue(0),
      _qemu_display_frame_count: vi.fn().mockReturnValue(0),
      _qemu_display_check_dirty: vi.fn().mockReturnValue(0),
      _qemu_setup_display: vi.fn().mockReturnValue(1),
      HEAPU8: {
        buffer: new ArrayBuffer(640 * 480 * 4),
      },
    };
  });

  afterEach(() => {
    if (renderer) {
      renderer.stop();
    }
    globalThis.ImageData = originalImageData;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).HEAPU8;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).wasmMemory;
  });

  it('creates a DisplayRenderer instance', () => {
    renderer = new DisplayRenderer(canvas, mockModule);
    expect(renderer).toBeInstanceOf(DisplayRenderer);
  });

  it('starts and stops the render loop', () => {
    renderer = new DisplayRenderer(canvas, mockModule);
    vi.useFakeTimers();

    renderer.start();
    expect(renderer.isRunning).toBe(true);

    renderer.stop();
    expect(renderer.isRunning).toBe(false);

    vi.useRealTimers();
  });

  it('calls _qemu_setup_display on start', () => {
    renderer = new DisplayRenderer(canvas, mockModule);
    vi.useFakeTimers();

    renderer.start();
    expect(mockModule._qemu_setup_display).toHaveBeenCalled();

    renderer.stop();
    vi.useRealTimers();
  });

  it('retries display setup until QEMU console is ready', () => {
    renderer = new DisplayRenderer(canvas, mockModule);
    vi.useFakeTimers();

    mockModule._qemu_setup_display = vi
      .fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1);

    renderer.start();
    vi.advanceTimersByTime(33);

    expect(mockModule._qemu_setup_display).toHaveBeenCalledTimes(2);

    renderer.stop();
    vi.useRealTimers();
  });

  it('emits diagnostic messages for setup and idle polling', () => {
    renderer = new DisplayRenderer(canvas, mockModule);
    vi.useFakeTimers();

    const onDiagnostic = vi.fn();
    renderer.onDiagnostic = onDiagnostic;

    renderer.start();
    vi.advanceTimersByTime(33 * 30);

    expect(onDiagnostic).toHaveBeenCalledWith(expect.stringContaining('setup result=1'));
    expect(onDiagnostic).toHaveBeenCalledWith(expect.stringContaining('idle frame_count=0 width=0 height=0'));

    renderer.stop();
    vi.useRealTimers();
  });

  it('polls display dimensions and data during render loop', () => {
    renderer = new DisplayRenderer(canvas, mockModule);
    vi.useFakeTimers();

    // Set up valid framebuffer
    mockModule._qemu_display_width = vi.fn().mockReturnValue(640);
    mockModule._qemu_display_height = vi.fn().mockReturnValue(480);
    mockModule._qemu_display_stride = vi.fn().mockReturnValue(640 * 4);
    mockModule._qemu_display_data = vi.fn().mockReturnValue(100);
    mockModule._qemu_display_check_dirty = vi.fn().mockReturnValue(1);

    renderer.start();
    vi.advanceTimersByTime(33); // One render cycle

    expect(mockModule._qemu_display_check_dirty).toHaveBeenCalled();
    expect(mockModule._qemu_display_width).toHaveBeenCalled();
    expect(mockModule._qemu_display_height).toHaveBeenCalled();
    expect(mockModule._qemu_display_data).toHaveBeenCalled();

    renderer.stop();
    vi.useRealTimers();
  });

  it('resizes canvas when VGA mode changes', () => {
    renderer = new DisplayRenderer(canvas, mockModule);
    vi.useFakeTimers();

    // Set up framebuffer with new dimensions
    const newWidth = 800;
    const newHeight = 600;
    const bufSize = newWidth * newHeight * 4;
    mockModule.HEAPU8 = { buffer: new ArrayBuffer(bufSize + 1000) };
    mockModule._qemu_display_width = vi.fn().mockReturnValue(newWidth);
    mockModule._qemu_display_height = vi.fn().mockReturnValue(newHeight);
    mockModule._qemu_display_stride = vi.fn().mockReturnValue(newWidth * 4);
    mockModule._qemu_display_data = vi.fn().mockReturnValue(100);
    mockModule._qemu_display_check_dirty = vi.fn().mockReturnValue(1);

    renderer.start();
    vi.advanceTimersByTime(33);

    expect(canvas.width).toBe(newWidth);
    expect(canvas.height).toBe(newHeight);

    renderer.stop();
    vi.useRealTimers();
  });

  it('fires onFirstFrame callback on the first valid framebuffer', () => {
    renderer = new DisplayRenderer(canvas, mockModule);
    vi.useFakeTimers();

    const onFirstFrame = vi.fn();
    renderer.onFirstFrame = onFirstFrame;

    // Set up a valid framebuffer
    const w = 10;
    const h = 10;
    const bufSize = w * h * 4 + 1000;
    const buffer = new ArrayBuffer(bufSize);
    const view = new Uint8Array(buffer);
    // Fill with a single repeated color at offset 100
    const offset = 100;
    for (let i = 0; i < w * h; i++) {
      const base = offset + i * 4;
      view[base] = 0x00;       // B
      view[base + 1] = 0x00;   // G
      view[base + 2] = 0xAA;   // R
      view[base + 3] = 0;            // X
    }

    mockModule.HEAPU8 = { buffer };
    mockModule._qemu_display_width = vi.fn().mockReturnValue(w);
    mockModule._qemu_display_height = vi.fn().mockReturnValue(h);
    mockModule._qemu_display_stride = vi.fn().mockReturnValue(w * 4);
    mockModule._qemu_display_data = vi.fn().mockReturnValue(offset);
    mockModule._qemu_display_check_dirty = vi.fn().mockReturnValue(1);

    renderer.start();
    vi.advanceTimersByTime(33);

    expect(onFirstFrame).toHaveBeenCalled();

    renderer.stop();
    vi.useRealTimers();
  });

  it('does not render when display is not dirty', () => {
    renderer = new DisplayRenderer(canvas, mockModule);
    vi.useFakeTimers();

    mockModule._qemu_display_check_dirty = vi.fn().mockReturnValue(0);
    mockModule._qemu_display_width = vi.fn().mockReturnValue(640);
    mockModule._qemu_display_height = vi.fn().mockReturnValue(480);
    mockModule._qemu_display_stride = vi.fn().mockReturnValue(640 * 4);

    renderer.start();
    vi.advanceTimersByTime(33);

    // Data should not be polled when not dirty
    expect(mockModule._qemu_display_data).not.toHaveBeenCalled();

    renderer.stop();
    vi.useRealTimers();
  });

  it('does not render when framebuffer pointer is 0 (null)', () => {
    renderer = new DisplayRenderer(canvas, mockModule);
    vi.useFakeTimers();

    mockModule._qemu_display_check_dirty = vi.fn().mockReturnValue(1);
    mockModule._qemu_display_width = vi.fn().mockReturnValue(640);
    mockModule._qemu_display_height = vi.fn().mockReturnValue(480);
    mockModule._qemu_display_stride = vi.fn().mockReturnValue(640 * 4);
    mockModule._qemu_display_data = vi.fn().mockReturnValue(8);

    renderer.start();
    vi.advanceTimersByTime(33);

    // Should have called data but not blown up
    expect(mockModule._qemu_display_data).toHaveBeenCalled();

    renderer.stop();
    vi.useRealTimers();
  });

  it('reports render errors through diagnostics', () => {
    renderer = new DisplayRenderer(canvas, mockModule);
    vi.useFakeTimers();

    const onDiagnostic = vi.fn();
    renderer.onDiagnostic = onDiagnostic;
    globalThis.ImageData = vi.fn(() => {
      throw new Error('ImageData failed');
    });

    mockModule._qemu_display_check_dirty = vi.fn().mockReturnValue(1);
    mockModule._qemu_display_width = vi.fn().mockReturnValue(2);
    mockModule._qemu_display_height = vi.fn().mockReturnValue(2);
    mockModule._qemu_display_stride = vi.fn().mockReturnValue(8);
    mockModule._qemu_display_data = vi.fn().mockReturnValue(8);
    mockModule.HEAPU8 = { buffer: new ArrayBuffer(64) };

    renderer.start();
    vi.advanceTimersByTime(33);

    expect(onDiagnostic).toHaveBeenCalledWith(expect.stringContaining('render error=ImageData failed'));

    renderer.stop();
    vi.useRealTimers();
  });

  it('falls back to wasmMemory when HEAPU8 is unavailable', () => {
    renderer = new DisplayRenderer(canvas, mockModule);
    vi.useFakeTimers();

    const onFirstFrame = vi.fn();
    renderer.onFirstFrame = onFirstFrame;

    const width = 2;
    const height = 2;
    const stride = 8;
    const fbPtr = 16;
    const buffer = new ArrayBuffer(64);
    const view = new Uint8Array(buffer);

    for (let i = 0; i < width * height; i++) {
      const base = fbPtr + i * 4;
      view[base] = 0x00;
      view[base + 1] = 0x00;
      view[base + 2] = 0xAA;
      view[base + 3] = 0x00;
    }

    mockModule._qemu_display_check_dirty = vi.fn().mockReturnValue(1);
    mockModule._qemu_display_width = vi.fn().mockReturnValue(width);
    mockModule._qemu_display_height = vi.fn().mockReturnValue(height);
    mockModule._qemu_display_stride = vi.fn().mockReturnValue(stride);
    mockModule._qemu_display_data = vi.fn().mockReturnValue(fbPtr);
    delete mockModule.HEAPU8;
    mockModule.wasmMemory = { buffer };

    renderer.start();
    vi.advanceTimersByTime(33);

    expect(onFirstFrame).toHaveBeenCalled();

    renderer.stop();
    vi.useRealTimers();
  });

  it('falls back to global HEAPU8 when module memory views are unavailable', () => {
    renderer = new DisplayRenderer(canvas, mockModule);
    vi.useFakeTimers();

    const onFirstFrame = vi.fn();
    renderer.onFirstFrame = onFirstFrame;

    const width = 2;
    const height = 2;
    const stride = 8;
    const fbPtr = 16;
    const buffer = new ArrayBuffer(64);
    const view = new Uint8Array(buffer);

    for (let i = 0; i < width * height; i++) {
      const base = fbPtr + i * 4;
      view[base] = 0x00;
      view[base + 1] = 0x00;
      view[base + 2] = 0xAA;
      view[base + 3] = 0x00;
    }

    mockModule._qemu_display_check_dirty = vi.fn().mockReturnValue(1);
    mockModule._qemu_display_width = vi.fn().mockReturnValue(width);
    mockModule._qemu_display_height = vi.fn().mockReturnValue(height);
    mockModule._qemu_display_stride = vi.fn().mockReturnValue(stride);
    mockModule._qemu_display_data = vi.fn().mockReturnValue(fbPtr);
    delete mockModule.HEAPU8;
    delete mockModule.wasmMemory;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).HEAPU8 = { buffer };

    renderer.start();
    vi.advanceTimersByTime(33);

    expect(onFirstFrame).toHaveBeenCalled();

    renderer.stop();
    vi.useRealTimers();
  });

  it('converts framebuffer rows using stride instead of assuming tight packing', () => {
    const width = 2;
    const height = 2;
    const stride = 12;

    const bgrx = new Uint8ClampedArray([
      0x10, 0x20, 0x30, 0x00,
      0x40, 0x50, 0x60, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x70, 0x80, 0x90, 0x00,
      0xA0, 0xB0, 0xC0, 0x00,
      0x00, 0x00, 0x00, 0x00,
    ]);

    const rgba = convertBGRXtoRGBA(bgrx, width, height, stride);

    expect(Array.from(rgba)).toEqual([
      0x30, 0x20, 0x10, 0xFF,
      0x60, 0x50, 0x40, 0xFF,
      0x90, 0x80, 0x70, 0xFF,
      0xC0, 0xB0, 0xA0, 0xFF,
    ]);
  });

  it('uses setInterval with ~30ms interval (not requestAnimationFrame)', () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    renderer = new DisplayRenderer(canvas, mockModule);
    renderer.start();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 33);

    renderer.stop();
    setIntervalSpy.mockRestore();
    vi.useRealTimers();
  });

  it('stops the render loop when stop() is called', () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    renderer = new DisplayRenderer(canvas, mockModule);
    renderer.start();
    renderer.stop();

    expect(clearIntervalSpy).toHaveBeenCalled();

    clearIntervalSpy.mockRestore();
    vi.useRealTimers();
  });
});
