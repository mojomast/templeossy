/**
 * mouse.ts — Mouse input handler for TempleOS Browser.
 *
 * Captures mouse movement and button events on the canvas element and forwards
 * them to QEMU via the exported _qemu_input_send_mouse function. Uses
 * MouseEvent.movementX/Y for relative deltas and tracks button state as a
 * bitmask (left=bit0, right=bit1, middle=bit2).
 *
 * The C backend signature is:
 *   void qemu_input_send_mouse(int dx, int dy, int dz, int buttons)
 *   where dz is scroll wheel delta and buttons is a bitmask.
 */

/** Minimal interface for the Emscripten QEMU Module's mouse input export. */
export interface MouseModule {
  _qemu_input_send_mouse(dx: number, dy: number, dz: number, buttons: number): void;
}

/**
 * Convert MouseEvent.button (0=left, 1=middle, 2=right) to a bitmask bit.
 *
 * QEMU button mask: bit 0 = left, bit 1 = right, bit 2 = middle
 * MouseEvent.button: 0 = left, 1 = middle, 2 = right
 */
function buttonBit(button: number): number {
  switch (button) {
    case 0: return 0x1; // left
    case 1: return 0x4; // middle
    case 2: return 0x2; // right
    default: return 0;
  }
}

/**
 * MouseHandler captures mouse events on the canvas and forwards them to QEMU.
 *
 * Uses MouseEvent.movementX/Y for relative deltas (works without Pointer Lock).
 * For better mouse capture, Pointer Lock can be requested on click — this is
 * handled externally if desired.
 *
 * Usage:
 *   const handler = new MouseHandler(canvas, container, module);
 *   handler.attach();
 *   // ...later...
 *   handler.detach();
 */
export class MouseHandler {
  private canvas: HTMLCanvasElement;
  private module: MouseModule;

  /** Current button state bitmask (bit 0=left, bit 1=right, bit 2=middle). */
  private buttonState = 0;

  /** Bound event handlers for cleanup. */
  private boundMouseMove: ((e: MouseEvent) => void) | null = null;
  private boundMouseDown: ((e: MouseEvent) => void) | null = null;
  private boundMouseUp: ((e: MouseEvent) => void) | null = null;
  private boundContextMenu: ((e: MouseEvent) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, _container: HTMLElement, module: MouseModule) {
    this.canvas = canvas;
    // _container reserved for future Pointer Lock API integration
    this.module = module;
  }

  /**
   * Attach event listeners to the canvas.
   * Call this to start capturing mouse input.
   */
  attach(): void {
    this.boundMouseMove = this.handleMouseMove.bind(this);
    this.boundMouseDown = this.handleMouseDown.bind(this);
    this.boundMouseUp = this.handleMouseUp.bind(this);
    this.boundContextMenu = this.handleContextMenu.bind(this);

    this.canvas.addEventListener('mousemove', this.boundMouseMove);
    this.canvas.addEventListener('mousedown', this.boundMouseDown);
    this.canvas.addEventListener('mouseup', this.boundMouseUp);
    this.canvas.addEventListener('contextmenu', this.boundContextMenu);
  }

  /**
   * Detach event listeners and reset state.
   * Call this to stop capturing mouse input.
   */
  detach(): void {
    if (this.boundMouseMove) {
      this.canvas.removeEventListener('mousemove', this.boundMouseMove);
      this.boundMouseMove = null;
    }
    if (this.boundMouseDown) {
      this.canvas.removeEventListener('mousedown', this.boundMouseDown);
      this.boundMouseDown = null;
    }
    if (this.boundMouseUp) {
      this.canvas.removeEventListener('mouseup', this.boundMouseUp);
      this.boundMouseUp = null;
    }
    if (this.boundContextMenu) {
      this.canvas.removeEventListener('contextmenu', this.boundContextMenu);
      this.boundContextMenu = null;
    }

    this.buttonState = 0;
  }

  /** Handle mousemove — send relative deltas to QEMU. */
  private handleMouseMove(e: MouseEvent): void {
    const dx = e.movementX;
    const dy = e.movementY;
    this.module._qemu_input_send_mouse(dx, dy, 0, this.buttonState);
  }

  /** Handle mousedown — update button state and send to QEMU. */
  private handleMouseDown(e: MouseEvent): void {
    const bit = buttonBit(e.button);
    this.buttonState |= bit;
    this.module._qemu_input_send_mouse(0, 0, 0, this.buttonState);
  }

  /** Handle mouseup — update button state and send to QEMU. */
  private handleMouseUp(e: MouseEvent): void {
    const bit = buttonBit(e.button);
    this.buttonState &= ~bit;
    this.module._qemu_input_send_mouse(0, 0, 0, this.buttonState);
  }

  /** Prevent right-click context menu on the canvas. */
  private handleContextMenu(e: MouseEvent): void {
    e.preventDefault();
  }
}
