/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SCANCODE_MAP,
  KeyboardHandler,
  type InputModule,
} from './input';

describe('SCANCODE_MAP', () => {
  describe('alphanumeric keys', () => {
    it('maps a-z keys to correct scancodes', () => {
      // PS/2 Set 1 scancodes for a-z (not alphabetical — follows keyboard layout)
      const expectedMappings: Record<string, number> = {
        KeyA: 0x1E,
        KeyB: 0x30,
        KeyC: 0x2E,
        KeyD: 0x20,
        KeyE: 0x12,
        KeyF: 0x21,
        KeyG: 0x22,
        KeyH: 0x23,
        KeyI: 0x17,
        KeyJ: 0x24,
        KeyK: 0x25,
        KeyL: 0x26,
        KeyM: 0x32,
        KeyN: 0x31,
        KeyO: 0x18,
        KeyP: 0x19,
        KeyQ: 0x10,
        KeyR: 0x13,
        KeyS: 0x1F,
        KeyT: 0x14,
        KeyU: 0x16,
        KeyV: 0x2F,
        KeyW: 0x11,
        KeyX: 0x2D,
        KeyY: 0x15,
        KeyZ: 0x2C,
      };

      for (const [code, scancode] of Object.entries(expectedMappings)) {
        expect(SCANCODE_MAP[code]).toBe(scancode);
      }
    });

    it('maps 0-9 keys to correct scancodes', () => {
      const expectedMappings: Record<string, number> = {
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
      };

      for (const [code, scancode] of Object.entries(expectedMappings)) {
        expect(SCANCODE_MAP[code]).toBe(scancode);
      }
    });
  });

  describe('special keys', () => {
    it('maps Enter to 0x1C', () => {
      expect(SCANCODE_MAP['Enter']).toBe(0x1C);
    });

    it('maps Escape to 0x01', () => {
      expect(SCANCODE_MAP['Escape']).toBe(0x01);
    });

    it('maps Backspace to 0x0E', () => {
      expect(SCANCODE_MAP['Backspace']).toBe(0x0E);
    });

    it('maps Tab to 0x0F', () => {
      expect(SCANCODE_MAP['Tab']).toBe(0x0F);
    });

    it('maps Space to 0x39', () => {
      expect(SCANCODE_MAP['Space']).toBe(0x39);
    });

    it('maps arrow keys correctly', () => {
      expect(SCANCODE_MAP['ArrowUp']).toBe(0x48);
      expect(SCANCODE_MAP['ArrowDown']).toBe(0x50);
      expect(SCANCODE_MAP['ArrowLeft']).toBe(0x4B);
      expect(SCANCODE_MAP['ArrowRight']).toBe(0x4D);
    });

    it('maps Home, End, Insert, Delete, PageUp, PageDown', () => {
      expect(SCANCODE_MAP['Home']).toBe(0x47);
      expect(SCANCODE_MAP['End']).toBe(0x4F);
      expect(SCANCODE_MAP['Insert']).toBe(0x52);
      expect(SCANCODE_MAP['Delete']).toBe(0x53);
      expect(SCANCODE_MAP['PageUp']).toBe(0x49);
      expect(SCANCODE_MAP['PageDown']).toBe(0x51);
    });
  });

  describe('function keys', () => {
    it('maps F1 through F12 to correct scancodes', () => {
      const expectedMappings: Record<string, number> = {
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
      };

      for (const [code, scancode] of Object.entries(expectedMappings)) {
        expect(SCANCODE_MAP[code]).toBe(scancode);
      }
    });
  });

  describe('modifier keys', () => {
    it('maps ShiftLeft to 0x2A', () => {
      expect(SCANCODE_MAP['ShiftLeft']).toBe(0x2A);
    });

    it('maps ShiftRight to 0x36', () => {
      expect(SCANCODE_MAP['ShiftRight']).toBe(0x36);
    });

    it('maps ControlLeft to 0x1D', () => {
      expect(SCANCODE_MAP['ControlLeft']).toBe(0x1D);
    });

    it('maps AltLeft to 0x38', () => {
      expect(SCANCODE_MAP['AltLeft']).toBe(0x38);
    });

    it('maps CapsLock to 0x3A', () => {
      expect(SCANCODE_MAP['CapsLock']).toBe(0x3A);
    });
  });

  describe('punctuation and symbol keys', () => {
    it('maps common punctuation keys', () => {
      expect(SCANCODE_MAP['Minus']).toBe(0x0C);
      expect(SCANCODE_MAP['Equal']).toBe(0x0D);
      expect(SCANCODE_MAP['BracketLeft']).toBe(0x1A);
      expect(SCANCODE_MAP['BracketRight']).toBe(0x1B);
      expect(SCANCODE_MAP['Backslash']).toBe(0x2B);
      expect(SCANCODE_MAP['Semicolon']).toBe(0x27);
      expect(SCANCODE_MAP['Quote']).toBe(0x28);
      expect(SCANCODE_MAP['Backquote']).toBe(0x29);
      expect(SCANCODE_MAP['Comma']).toBe(0x33);
      expect(SCANCODE_MAP['Period']).toBe(0x34);
      expect(SCANCODE_MAP['Slash']).toBe(0x35);
    });
  });
});

describe('KeyboardHandler', () => {
  let container: HTMLElement;
  let mockModule: InputModule;
  let handler: KeyboardHandler;

  beforeEach(() => {
    container = document.createElement('div');
    container.setAttribute('tabindex', '0');
    document.body.appendChild(container);

    mockModule = {
      _qemu_input_send_key: vi.fn(),
    };
  });

  afterEach(() => {
    if (handler) {
      handler.detach();
    }
    document.body.removeChild(container);
  });

  function createKeyEvent(type: string, code: string, opts?: Partial<KeyboardEventInit>): KeyboardEvent {
    return new KeyboardEvent(type, {
      code,
      bubbles: true,
      cancelable: true,
      ...opts,
    });
  }

  it('creates a KeyboardHandler instance', () => {
    handler = new KeyboardHandler(container, mockModule);
    expect(handler).toBeInstanceOf(KeyboardHandler);
  });

  describe('keydown forwarding', () => {
    it('sends scancode on keydown when container is focused', () => {
      handler = new KeyboardHandler(container, mockModule);
      handler.attach();

      container.focus();
      container.dispatchEvent(createKeyEvent('keydown', 'KeyA'));

      expect(mockModule._qemu_input_send_key).toHaveBeenCalledWith(0x1E, 1);
    });

    it('sends scancode on keyup when container is focused', () => {
      handler = new KeyboardHandler(container, mockModule);
      handler.attach();

      container.focus();
      container.dispatchEvent(createKeyEvent('keyup', 'KeyA'));

      expect(mockModule._qemu_input_send_key).toHaveBeenCalledWith(0x1E, 0);
    });

    it('sends correct scancodes for special keys', () => {
      handler = new KeyboardHandler(container, mockModule);
      handler.attach();
      container.focus();

      container.dispatchEvent(createKeyEvent('keydown', 'Enter'));
      expect(mockModule._qemu_input_send_key).toHaveBeenCalledWith(0x1C, 1);

      container.dispatchEvent(createKeyEvent('keydown', 'Escape'));
      expect(mockModule._qemu_input_send_key).toHaveBeenCalledWith(0x01, 1);

      container.dispatchEvent(createKeyEvent('keydown', 'Backspace'));
      expect(mockModule._qemu_input_send_key).toHaveBeenCalledWith(0x0E, 1);
    });

    it('sends correct scancodes for function keys', () => {
      handler = new KeyboardHandler(container, mockModule);
      handler.attach();
      container.focus();

      container.dispatchEvent(createKeyEvent('keydown', 'F1'));
      expect(mockModule._qemu_input_send_key).toHaveBeenCalledWith(0x3B, 1);

      container.dispatchEvent(createKeyEvent('keydown', 'F5'));
      expect(mockModule._qemu_input_send_key).toHaveBeenCalledWith(0x3F, 1);

      container.dispatchEvent(createKeyEvent('keydown', 'F12'));
      expect(mockModule._qemu_input_send_key).toHaveBeenCalledWith(0x58, 1);
    });

    it('sends correct scancodes for modifier keys', () => {
      handler = new KeyboardHandler(container, mockModule);
      handler.attach();
      container.focus();

      container.dispatchEvent(createKeyEvent('keydown', 'ShiftLeft'));
      expect(mockModule._qemu_input_send_key).toHaveBeenCalledWith(0x2A, 1);

      container.dispatchEvent(createKeyEvent('keydown', 'ShiftRight'));
      expect(mockModule._qemu_input_send_key).toHaveBeenCalledWith(0x36, 1);

      container.dispatchEvent(createKeyEvent('keydown', 'ControlLeft'));
      expect(mockModule._qemu_input_send_key).toHaveBeenCalledWith(0x1D, 1);

      container.dispatchEvent(createKeyEvent('keydown', 'AltLeft'));
      expect(mockModule._qemu_input_send_key).toHaveBeenCalledWith(0x38, 1);
    });
  });

  describe('focus gating', () => {
    it('does NOT forward keys when container is not focused', () => {
      handler = new KeyboardHandler(container, mockModule);
      handler.attach();

      // Explicitly blur the container so document.activeElement is not the container
      container.blur();
      expect(document.activeElement).not.toBe(container);

      // Dispatch keydown on container but it's not the active element
      container.dispatchEvent(createKeyEvent('keydown', 'KeyA'));

      // Handler should check document.activeElement and NOT forward
      expect(mockModule._qemu_input_send_key).not.toHaveBeenCalled();
    });

    it('forwards keys when container is focused', () => {
      handler = new KeyboardHandler(container, mockModule);
      handler.attach();

      container.focus();
      expect(document.activeElement).toBe(container);

      container.dispatchEvent(createKeyEvent('keydown', 'KeyB'));
      expect(mockModule._qemu_input_send_key).toHaveBeenCalledWith(0x30, 1);
    });

    it('stops forwarding when focus moves to another element', () => {
      handler = new KeyboardHandler(container, mockModule);
      handler.attach();

      // Start focused
      container.focus();
      container.dispatchEvent(createKeyEvent('keydown', 'KeyA'));
      expect(mockModule._qemu_input_send_key).toHaveBeenCalledWith(0x1E, 1);

      // Move focus elsewhere (blur fires, releasing held keys)
      const otherEl = document.createElement('input');
      document.body.appendChild(otherEl);
      otherEl.focus();

      // Clear after blur releases so we only check the next keydown
      (mockModule._qemu_input_send_key as ReturnType<typeof vi.fn>).mockClear();

      // Key event on unfocused container should NOT be forwarded
      container.dispatchEvent(createKeyEvent('keydown', 'KeyB'));
      expect(mockModule._qemu_input_send_key).not.toHaveBeenCalled();

      document.body.removeChild(otherEl);
    });
  });

  describe('preventDefault for interceptable keys', () => {
    it('prevents default for F-keys', () => {
      handler = new KeyboardHandler(container, mockModule);
      handler.attach();
      container.focus();

      for (let i = 1; i <= 12; i++) {
        const event = createKeyEvent('keydown', `F${i}`);
        const spy = vi.spyOn(event, 'preventDefault');
        container.dispatchEvent(event);
        expect(spy).toHaveBeenCalled();
      }
    });

    it('prevents default for Escape', () => {
      handler = new KeyboardHandler(container, mockModule);
      handler.attach();
      container.focus();

      const event = createKeyEvent('keydown', 'Escape');
      const spy = vi.spyOn(event, 'preventDefault');
      container.dispatchEvent(event);
      expect(spy).toHaveBeenCalled();
    });

    it('prevents default for Tab', () => {
      handler = new KeyboardHandler(container, mockModule);
      handler.attach();
      container.focus();

      const event = createKeyEvent('keydown', 'Tab');
      const spy = vi.spyOn(event, 'preventDefault');
      container.dispatchEvent(event);
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('blur releases all held keys', () => {
    it('releases all currently held keys on blur', () => {
      handler = new KeyboardHandler(container, mockModule);
      handler.attach();
      container.focus();

      // Press two keys
      container.dispatchEvent(createKeyEvent('keydown', 'KeyA'));
      container.dispatchEvent(createKeyEvent('keydown', 'ShiftLeft'));

      expect(mockModule._qemu_input_send_key).toHaveBeenCalledWith(0x1E, 1);
      expect(mockModule._qemu_input_send_key).toHaveBeenCalledWith(0x2A, 1);

      // Clear mock to isolate blur releases
      (mockModule._qemu_input_send_key as ReturnType<typeof vi.fn>).mockClear();

      // Trigger blur
      container.dispatchEvent(new FocusEvent('blur'));

      // Should release both keys
      expect(mockModule._qemu_input_send_key).toHaveBeenCalledWith(0x1E, 0);
      expect(mockModule._qemu_input_send_key).toHaveBeenCalledWith(0x2A, 0);
    });

    it('does not send extra releases for already released keys', () => {
      handler = new KeyboardHandler(container, mockModule);
      handler.attach();
      container.focus();

      // Press and release a key
      container.dispatchEvent(createKeyEvent('keydown', 'KeyA'));
      container.dispatchEvent(createKeyEvent('keyup', 'KeyA'));

      (mockModule._qemu_input_send_key as ReturnType<typeof vi.fn>).mockClear();

      // Blur should not release KeyA again
      container.dispatchEvent(new FocusEvent('blur'));

      expect(mockModule._qemu_input_send_key).not.toHaveBeenCalledWith(0x1E, 0);
    });
  });

  describe('key repeat', () => {
    it('forwards repeated keydown events', () => {
      handler = new KeyboardHandler(container, mockModule);
      handler.attach();
      container.focus();

      // First keydown
      container.dispatchEvent(createKeyEvent('keydown', 'KeyA', { repeat: false }));
      // Repeated keydown (browser fires these automatically when holding)
      container.dispatchEvent(createKeyEvent('keydown', 'KeyA', { repeat: true }));
      container.dispatchEvent(createKeyEvent('keydown', 'KeyA', { repeat: true }));

      expect(mockModule._qemu_input_send_key).toHaveBeenCalledTimes(3);
      // All calls should be keydown (scancode, 1)
      expect(mockModule._qemu_input_send_key).toHaveBeenNthCalledWith(1, 0x1E, 1);
      expect(mockModule._qemu_input_send_key).toHaveBeenNthCalledWith(2, 0x1E, 1);
      expect(mockModule._qemu_input_send_key).toHaveBeenNthCalledWith(3, 0x1E, 1);
    });
  });

  describe('unmapped keys', () => {
    it('ignores keys not in the scancode map', () => {
      handler = new KeyboardHandler(container, mockModule);
      handler.attach();
      container.focus();

      container.dispatchEvent(createKeyEvent('keydown', 'UnknownKey'));
      expect(mockModule._qemu_input_send_key).not.toHaveBeenCalled();
    });
  });

  describe('detach', () => {
    it('stops forwarding events after detach', () => {
      handler = new KeyboardHandler(container, mockModule);
      handler.attach();
      container.focus();

      handler.detach();

      container.dispatchEvent(createKeyEvent('keydown', 'KeyA'));
      expect(mockModule._qemu_input_send_key).not.toHaveBeenCalled();
    });

    it('releases all held keys on detach', () => {
      handler = new KeyboardHandler(container, mockModule);
      handler.attach();
      container.focus();

      container.dispatchEvent(createKeyEvent('keydown', 'KeyA'));
      (mockModule._qemu_input_send_key as ReturnType<typeof vi.fn>).mockClear();

      handler.detach();

      expect(mockModule._qemu_input_send_key).toHaveBeenCalledWith(0x1E, 0);
    });
  });
});
