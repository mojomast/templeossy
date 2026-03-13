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
 * - Loading indicator until first visible frame (>1 distinct color)
 */

/** Minimal interface for the Emscripten QEMU Module's display-related exports. */
export interface QemuModule {
  _qemu_display_data(): number;
  _qemu_display_width(): number;
  _qemu_display_height(): number;
  _qemu_display_stride(): number;
  _qemu_display_frame_count(): number;
  _qemu_display_check_dirty(): number;
  _qemu_setup_display(): number;
  HEAPU8?: { buffer: ArrayBufferLike };
  wasmMemory?: { buffer: ArrayBufferLike };
}

function getGlobalMemoryBuffer(): ArrayBufferLike | null {
  const root = globalThis as {
    HEAPU8?: { buffer: ArrayBufferLike };
    wasmMemory?: { buffer: ArrayBufferLike };
  };
  // Prefer wasmMemory.buffer: WebAssembly.Memory.buffer always reflects the
  // current backing store after memory.grow(), whereas HEAPU8 is a typed-array
  // view that may reference a stale (detached) ArrayBuffer.
  return root.wasmMemory?.buffer ?? root.HEAPU8?.buffer ?? null;
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
  stride = width * 4,
): Uint8ClampedArray<ArrayBuffer> {
  const pixelCount = width * height;
  const rgba = new Uint8ClampedArray(pixelCount * 4);

  for (let y = 0; y < height; y++) {
    const rowSrc = y * stride;
    const rowDst = y * width * 4;

    for (let x = 0; x < width; x++) {
      const src = rowSrc + x * 4;
      const dst = rowDst + x * 4;
      rgba[dst] = bgrx[src + 2];     // R ← was byte 2 (Red in BGRX)
      rgba[dst + 1] = bgrx[src + 1]; // G ← unchanged
      rgba[dst + 2] = bgrx[src];     // B ← was byte 0 (Blue in BGRX)
      rgba[dst + 3] = 0xFF;          // A ← always opaque
    }
  }

  return rgba;
}

/**
 * Detect whether a frame is visibly populated by checking for >1 distinct color.
 *
 * Used to hide the loading indicator once actual VGA content appears.
 * A blank frame is typically a single solid color. BIOS and text-mode output often
 * uses exactly two colors, so that should count as visible content.
 *
 * @param rgba - RGBA pixel data (as from convertBGRXtoRGBA)
 * @returns true if the frame contains more than 1 distinct color
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

    // Early exit once we've found 2+ colors
    if (colors.size > 1) {
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
  private _displayReady = false;
  private lastSetupResult: number | null = null;
  private lastFrameCount: number | null = null;
  private lastDirtyDiagnosticKey = '';
  private lastSkipDiagnostic = '';
  private lastErrorDiagnostic = '';
  private idlePolls = 0;

  /** Current tracked framebuffer dimensions */
  private currentWidth = 0;
  private currentHeight = 0;

  /** Callback fired when the first non-blank frame is detected. */
  onFirstFrame: (() => void) | null = null;

  /** Callback fired for lightweight display diagnostics in the debug log. */
  onDiagnostic: ((message: string) => void) | null = null;

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

    this._displayReady = this.trySetupDisplay();

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
      if (!this._displayReady) {
        this._displayReady = this.trySetupDisplay();
        if (!this._displayReady) return;
      }

      // Check if the display has been updated
      const dirty = this.module._qemu_display_check_dirty();
      if (!dirty) {
        this.idlePolls++;
        if (this.idlePolls % 30 === 0) {
          this.reportDiagnostic('idle');
        }
        return;
      }

      this.idlePolls = 0;

      const width = this.module._qemu_display_width();
      const height = this.module._qemu_display_height();
      const stride = this.module._qemu_display_stride();
      const fbPtr = this.module._qemu_display_data();
      this.reportDirtyDiagnostic(width, height, stride, fbPtr);

      // Skip if no valid framebuffer yet
      if (width <= 0 || height <= 0 || fbPtr === 0) {
        this.reportSkipDiagnostic(`invalid width=${width} height=${height} fb=${fbPtr}`);
        return;
      }

      // Handle VGA mode switch — resize canvas if dimensions changed
      if (width !== this.currentWidth || height !== this.currentHeight) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.currentWidth = width;
        this.currentHeight = height;
      }

      // Read framebuffer from Wasm linear memory.
      // Prefer wasmMemory.buffer: WebAssembly.Memory.buffer always returns the
      // current backing store even after memory.grow(), whereas HEAPU8 is a
      // typed-array view that can reference a stale (detached) buffer after
      // Wasm memory growth — leading to OOB reads or crashes.
      const byteLength = stride * height;
      const memoryBuffer = this.module.wasmMemory?.buffer
        ?? this.module.HEAPU8?.buffer
        ?? getGlobalMemoryBuffer();

      if (!memoryBuffer) {
        this.reportSkipDiagnostic('no wasm memory buffer available');
        return;
      }

      // Safety check: ensure we don't read beyond the buffer
      if (fbPtr + byteLength > memoryBuffer.byteLength) {
        this.reportSkipDiagnostic(
          `oob fb=${fbPtr} bytes=${byteLength} heap=${memoryBuffer.byteLength}`,
        );
        return;
      }

      const bgrx = new Uint8ClampedArray(memoryBuffer, fbPtr, byteLength);

      // Convert BGRX → RGBA
      const rgba = convertBGRXtoRGBA(bgrx, width, height, stride);

      // Treat the first valid framebuffer as display-ready. Some text-mode and
      // BIOS frames can remain visually sparse while still being legitimate
      // output, so waiting for a richer color heuristic keeps the overlay stuck.
      if (!this._firstFrameFired) {
        this._firstFrameFired = true;
        this.onFirstFrame?.();
      }

      // Create ImageData and render to canvas
      // convertBGRXtoRGBA returns Uint8ClampedArray<ArrayBuffer> (not SharedArrayBuffer)
      const imageData = new ImageData(rgba, width, height);
      this.ctx.putImageData(imageData, 0, 0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message !== this.lastErrorDiagnostic) {
        this.lastErrorDiagnostic = message;
        this.onDiagnostic?.(`render error=${message}`);
      }
    }
  }

  private trySetupDisplay(): boolean {
    const result = this.module._qemu_setup_display();
    if (result !== this.lastSetupResult) {
      this.lastSetupResult = result;
      this.reportDiagnostic(`setup result=${result}`);
    }
    return result === 1 || result === -1;
  }

  private reportDiagnostic(message: string): void {
    try {
      const frameCount = this.module._qemu_display_frame_count();
      const width = this.module._qemu_display_width();
      const height = this.module._qemu_display_height();

      if (message === 'idle' && frameCount === this.lastFrameCount) {
        this.onDiagnostic?.(`idle frame_count=${frameCount} width=${width} height=${height}`);
      } else {
        this.onDiagnostic?.(`${message} frame_count=${frameCount} width=${width} height=${height}`);
      }

      this.lastFrameCount = frameCount;
    } catch {
      // Ignore diagnostic failures; they are non-essential.
    }
  }

  private reportDirtyDiagnostic(width: number, height: number, stride: number, fbPtr: number): void {
    try {
      const frameCount = this.module._qemu_display_frame_count();
      const key = `${width}x${height}/${stride}@${fbPtr}`;
      const shouldLog = key !== this.lastDirtyDiagnosticKey
        || frameCount <= 3
        || frameCount % 30 === 0;

      if (!shouldLog) return;

      if (key !== this.lastDirtyDiagnosticKey || frameCount <= 3 || frameCount % 30 === 0) {
        this.onDiagnostic?.(`dirty frame_count=${frameCount} width=${width} height=${height} stride=${stride} fb=${fbPtr}`);
      }
      this.lastDirtyDiagnosticKey = key;
    } catch {
      // Ignore diagnostic failures; they are non-essential.
    }
  }

  private reportSkipDiagnostic(message: string): void {
    if (message === this.lastSkipDiagnostic) return;
    this.lastSkipDiagnostic = message;
    this.onDiagnostic?.(`skip ${message}`);
  }
}
