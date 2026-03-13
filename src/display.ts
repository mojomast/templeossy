/**
 * display.ts — Canvas display rendering pipeline.
 *
 * Polls QEMU's framebuffer from Wasm memory via exported functions and renders
 * to an HTML canvas. Uses setInterval at ~30ms (NOT requestAnimationFrame —
 * rAF is hijacked by Emscripten's PROXY_TO_PTHREAD).
 *
 * Handles:
 * - BGRX → RGBA pixel format conversion
 * - VGA mode switches (canvas resize on dimension change)
 * - Loading indicator until first non-blank frame (>2 distinct colors)
 */

/** Minimal interface for the Emscripten QEMU Module's display-related exports. */
export interface QemuModule {
  _qemu_display_data(): number;
  _qemu_display_width(): number;
  _qemu_display_height(): number;
  _qemu_display_check_dirty(): number;
  _qemu_setup_display(): number;
  HEAPU8: { buffer: ArrayBufferLike };
}

/** Render loop interval in milliseconds (~30 FPS). */
const RENDER_INTERVAL_MS = 33;

/**
 * Convert BGRX pixel data to RGBA pixel data suitable for canvas ImageData.
 *
 * QEMU DisplaySurface uses 32-bit BGRX format:
 *   byte 0 = Blue, byte 1 = Green, byte 2 = Red, byte 3 = unused (X)
 *
 * Canvas ImageData needs RGBA:
 *   byte 0 = Red, byte 1 = Green, byte 2 = Blue, byte 3 = Alpha
 *
 * We swap bytes 0 and 2, keep byte 1, and set byte 3 to 0xFF.
 */
export function convertBGRXtoRGBA(
  bgrx: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> {
  const pixelCount = width * height;
  const rgba = new Uint8ClampedArray(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    const src = i * 4;
    const dst = i * 4;
    rgba[dst] = bgrx[src + 2];     // R ← was byte 2 (Red in BGRX)
    rgba[dst + 1] = bgrx[src + 1]; // G ← unchanged
    rgba[dst + 2] = bgrx[src];     // B ← was byte 0 (Blue in BGRX)
    rgba[dst + 3] = 0xFF;          // A ← always opaque
  }

  return rgba;
}

/**
 * Detect whether a frame is "non-blank" by checking for >2 distinct colors.
 *
 * Used to hide the loading indicator once actual VGA content appears.
 * A blank/boot frame typically has only 1-2 colors (black, or black + cursor).
 * Real content (text mode, graphics) will have 3+ distinct pixel colors.
 *
 * @param rgba - RGBA pixel data (as from convertBGRXtoRGBA)
 * @returns true if the frame contains more than 2 distinct colors
 */
export function isNonBlankFrame(rgba: Uint8ClampedArray): boolean {
  if (rgba.length === 0) return false;

  const colors = new Set<number>();
  const pixelCount = rgba.length / 4;

  // Sample pixels — for performance, sample every Nth pixel for large frames
  const step = pixelCount > 10000 ? Math.floor(pixelCount / 5000) : 1;

  for (let i = 0; i < pixelCount; i += step) {
    const offset = i * 4;
    // Pack RGB into a single number for comparison (ignore alpha)
    const colorKey = (rgba[offset] << 16) | (rgba[offset + 1] << 8) | rgba[offset + 2];
    colors.add(colorKey);

    // Early exit once we've found 3+ colors
    if (colors.size > 2) {
      return true;
    }
  }

  return false;
}

/**
 * DisplayRenderer manages the setInterval-based render loop that polls
 * the QEMU framebuffer and renders to an HTML canvas.
 */
export class DisplayRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private module: QemuModule;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private _isRunning = false;
  private _firstFrameFired = false;

  /** Current tracked framebuffer dimensions */
  private currentWidth = 0;
  private currentHeight = 0;

  /** Callback fired when the first non-blank frame is detected. */
  onFirstFrame: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, module: QemuModule) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D rendering context from canvas');
    }
    this.ctx = ctx;
    this.module = module;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Start the display rendering loop.
   * Calls _qemu_setup_display() to attach the display change listener,
   * then begins polling at ~30 FPS.
   */
  start(): void {
    if (this._isRunning) return;

    // Set up the QEMU display backend
    this.module._qemu_setup_display();

    this._isRunning = true;
    this._firstFrameFired = false;
    this.intervalId = setInterval(() => this.renderFrame(), RENDER_INTERVAL_MS);
  }

  /** Stop the display rendering loop. */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this._isRunning = false;
  }

  /** Single render frame — called by setInterval. */
  private renderFrame(): void {
    try {
      // Check if the display has been updated
      const dirty = this.module._qemu_display_check_dirty();
      if (!dirty) return;

      const width = this.module._qemu_display_width();
      const height = this.module._qemu_display_height();
      const fbPtr = this.module._qemu_display_data();

      // Skip if no valid framebuffer yet
      if (width <= 0 || height <= 0 || fbPtr === 0) return;

      // Handle VGA mode switch — resize canvas if dimensions changed
      if (width !== this.currentWidth || height !== this.currentHeight) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.currentWidth = width;
        this.currentHeight = height;
      }

      // Read framebuffer from Wasm linear memory
      const byteLength = width * height * 4;

      // Safety check: ensure we don't read beyond the buffer
      if (fbPtr + byteLength > this.module.HEAPU8.buffer.byteLength) return;

      const bgrx = new Uint8ClampedArray(this.module.HEAPU8.buffer, fbPtr, byteLength);

      // Convert BGRX → RGBA
      const rgba = convertBGRXtoRGBA(bgrx, width, height);

      // Check for first non-blank frame
      if (!this._firstFrameFired && isNonBlankFrame(rgba)) {
        this._firstFrameFired = true;
        this.onFirstFrame?.();
      }

      // Create ImageData and render to canvas
      // convertBGRXtoRGBA returns Uint8ClampedArray<ArrayBuffer> (not SharedArrayBuffer)
      const imageData = new ImageData(rgba, width, height);
      this.ctx.putImageData(imageData, 0, 0);
    } catch {
      // Silently handle errors during rendering (Wasm memory may be resizing)
      // The next frame will retry
    }
  }
}
