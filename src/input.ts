/**
 * input.ts — Keyboard input handler for TempleOS Browser.
 *
 * Maps KeyboardEvent.code to PS/2 Set 1 scancodes and forwards them to QEMU
 * via the exported _qemu_input_send_key function. Only forwards events when
 * the canvas container is focused. Releases all held keys on blur to prevent
 * stuck keys.
 *
 * PS/2 Set 1 scancode reference:
 * https://wiki.osdev.org/PS/2_Keyboard#Scan_Code_Set_1
 */

/** Minimal interface for the Emscripten QEMU Module's keyboard input export. */
export interface InputModule {
  _qemu_input_send_key(scancode: number, down: number): void;
}

/**
 * Mapping from KeyboardEvent.code to PS/2 Set 1 scancodes.
 *
 * This covers all standard US QWERTY keys that TempleOS needs:
 * - Alphanumeric (a-z, 0-9)
 * - Special keys (Enter, Escape, Backspace, Tab, Space, arrows, etc.)
 * - Function keys (F1-F12)
 * - Modifier keys (Shift, Ctrl, Alt, CapsLock)
 * - Punctuation and symbol keys
 */
export const SCANCODE_MAP: Record<string, number> = {
  // Escape and function keys
  Escape: 0x01,
  F1: 0x3B,
  F2: 0x3C,
  F3: 0x3D,
  F4: 0x3E,
  F5: 0x3F,
  F6: 0x40,
  F7: 0x41,
  F8: 0x42,
  F9: 0x43,
  F10: 0x44,
  F11: 0x57,
  F12: 0x58,

  // Number row
  Backquote: 0x29,
  Digit1: 0x02,
  Digit2: 0x03,
  Digit3: 0x04,
  Digit4: 0x05,
  Digit5: 0x06,
  Digit6: 0x07,
  Digit7: 0x08,
  Digit8: 0x09,
  Digit9: 0x0A,
  Digit0: 0x0B,
  Minus: 0x0C,
  Equal: 0x0D,
  Backspace: 0x0E,

  // Top letter row
  Tab: 0x0F,
  KeyQ: 0x10,
  KeyW: 0x11,
  KeyE: 0x12,
  KeyR: 0x13,
  KeyT: 0x14,
  KeyY: 0x15,
  KeyU: 0x16,
  KeyI: 0x17,
  KeyO: 0x18,
  KeyP: 0x19,
  BracketLeft: 0x1A,
  BracketRight: 0x1B,
  Backslash: 0x2B,

  // Home row
  CapsLock: 0x3A,
  KeyA: 0x1E,
  KeyS: 0x1F,
  KeyD: 0x20,
  KeyF: 0x21,
  KeyG: 0x22,
  KeyH: 0x23,
  KeyJ: 0x24,
  KeyK: 0x25,
  KeyL: 0x26,
  Semicolon: 0x27,
  Quote: 0x28,
  Enter: 0x1C,

  // Bottom letter row
  ShiftLeft: 0x2A,
  KeyZ: 0x2C,
  KeyX: 0x2D,
  KeyC: 0x2E,
  KeyV: 0x2F,
  KeyB: 0x30,
  KeyN: 0x31,
  KeyM: 0x32,
  Comma: 0x33,
  Period: 0x34,
  Slash: 0x35,
  ShiftRight: 0x36,

  // Bottom row
  ControlLeft: 0x1D,
  AltLeft: 0x38,
  Space: 0x39,
  AltRight: 0xB8,       // Extended: 0x38 | 0x80
  ControlRight: 0x9D,   // Extended: 0x1D | 0x80

  // Navigation keys (extended — QEMU key numbers with 0x80 bit set)
  Insert: 0xD2,         // Extended: 0x52 | 0x80
  Delete: 0xD3,         // Extended: 0x53 | 0x80
  Home: 0xC7,           // Extended: 0x47 | 0x80
  End: 0xCF,            // Extended: 0x4F | 0x80
  PageUp: 0xC9,         // Extended: 0x49 | 0x80
  PageDown: 0xD1,       // Extended: 0x51 | 0x80

  // Arrow keys (extended — QEMU key numbers with 0x80 bit set)
  ArrowUp: 0xC8,        // Extended: 0x48 | 0x80
  ArrowDown: 0xD0,      // Extended: 0x50 | 0x80
  ArrowLeft: 0xCB,      // Extended: 0x4B | 0x80
  ArrowRight: 0xCD,     // Extended: 0x4D | 0x80

  // Numpad
  NumLock: 0x45,
  NumpadDivide: 0xB5,   // Extended: 0x35 | 0x80
  NumpadMultiply: 0x37,
  NumpadSubtract: 0x4A,
  Numpad7: 0x47,
  Numpad8: 0x48,
  Numpad9: 0x49,
  NumpadAdd: 0x4E,
  Numpad4: 0x4B,
  Numpad5: 0x4C,
  Numpad6: 0x4D,
  Numpad1: 0x4F,
  Numpad2: 0x50,
  Numpad3: 0x51,
  Numpad0: 0x52,
  NumpadDecimal: 0x53,
  NumpadEnter: 0x9C,    // Extended: 0x1C | 0x80
};

/**
 * Set of KeyboardEvent.code values that should have preventDefault() called
 * to prevent browser default behavior when the canvas container is focused.
 *
 * F-keys: prevent browser shortcuts (F5=refresh, F11=fullscreen, F12=devtools)
 * Escape: prevent exiting fullscreen prematurely
 * Tab: prevent focus leaving the canvas container
 * Space: prevent page scrolling
 */
const PREVENT_DEFAULT_KEYS = new Set<string>([
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'Escape',
  'Tab',
  'Space',
]);

/**
 * KeyboardHandler captures keyboard events on a container element and
 * forwards them to QEMU via the Emscripten module's exported function.
 *
 * Usage:
 *   const handler = new KeyboardHandler(container, module);
 *   handler.attach();
 *   // ...later...
 *   handler.detach();
 */
export class KeyboardHandler {
  private container: HTMLElement;
  private module: InputModule;

  /** Set of currently held key codes (for blur release). */
  private heldKeys = new Set<string>();

  /** Bound event handlers for cleanup. */
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private boundKeyUp: ((e: KeyboardEvent) => void) | null = null;
  private boundBlur: (() => void) | null = null;

  constructor(container: HTMLElement, module: InputModule) {
    this.container = container;
    this.module = module;
  }

  /**
   * Attach event listeners to the container.
   * Call this to start capturing keyboard input.
   */
  attach(): void {
    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.boundKeyUp = this.handleKeyUp.bind(this);
    this.boundBlur = this.handleBlur.bind(this);

    this.container.addEventListener('keydown', this.boundKeyDown);
    this.container.addEventListener('keyup', this.boundKeyUp);
    this.container.addEventListener('blur', this.boundBlur);
  }

  /**
   * Detach event listeners and release all held keys.
   * Call this to stop capturing keyboard input.
   */
  detach(): void {
    // Release all held keys before detaching
    this.releaseAllKeys();

    if (this.boundKeyDown) {
      this.container.removeEventListener('keydown', this.boundKeyDown);
      this.boundKeyDown = null;
    }
    if (this.boundKeyUp) {
      this.container.removeEventListener('keyup', this.boundKeyUp);
      this.boundKeyUp = null;
    }
    if (this.boundBlur) {
      this.container.removeEventListener('blur', this.boundBlur);
      this.boundBlur = null;
    }
  }

  /** Handle keydown events. */
  private handleKeyDown(e: KeyboardEvent): void {
    // Only forward when this container is the active element
    if (!this.isFocused()) return;

    const scancode = SCANCODE_MAP[e.code];
    if (scancode === undefined) return;

    // Prevent browser defaults for interceptable keys
    if (PREVENT_DEFAULT_KEYS.has(e.code)) {
      e.preventDefault();
    }

    // Track held keys (only add on initial press, not repeats)
    if (!e.repeat) {
      this.heldKeys.add(e.code);
    }

    // Forward to QEMU — including key repeat events
    this.module._qemu_input_send_key(scancode, 1);
  }

  /** Handle keyup events. */
  private handleKeyUp(e: KeyboardEvent): void {
    // Only forward when this container is the active element
    if (!this.isFocused()) return;

    const scancode = SCANCODE_MAP[e.code];
    if (scancode === undefined) return;

    // Prevent browser defaults for interceptable keys
    if (PREVENT_DEFAULT_KEYS.has(e.code)) {
      e.preventDefault();
    }

    // Remove from held keys
    this.heldKeys.delete(e.code);

    // Forward to QEMU
    this.module._qemu_input_send_key(scancode, 0);
  }

  /** Handle blur events — release all held keys to prevent stuck keys. */
  private handleBlur(): void {
    this.releaseAllKeys();
  }

  /** Release all currently held keys by sending keyup for each. */
  private releaseAllKeys(): void {
    for (const code of this.heldKeys) {
      const scancode = SCANCODE_MAP[code];
      if (scancode !== undefined) {
        this.module._qemu_input_send_key(scancode, 0);
      }
    }
    this.heldKeys.clear();
  }

  /** Check if the container element is currently focused. */
  private isFocused(): boolean {
    return document.activeElement === this.container;
  }
}
