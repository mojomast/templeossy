/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MouseHandler,
  type MouseModule,
} from './mouse';

describe('MouseHandler', () => {
  let canvas: HTMLCanvasElement;
  let container: HTMLElement;
  let mockModule: MouseModule;
  let handler: MouseHandler;

  beforeEach(() => {
    container = document.createElement('div');
    container.setAttribute('tabindex', '0');
    canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    container.appendChild(canvas);
    document.body.appendChild(container);

    mockModule = {
      _qemu_input_send_mouse: vi.fn(),
    };
  });

  afterEach(() => {
    if (handler) {
      handler.detach();
    }
    document.body.removeChild(container);
  });

  function createMouseEvent(
    type: string,
    opts?: Partial<MouseEventInit>,
  ): MouseEvent {
    return new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      ...opts,
    });
  }

  it('creates a MouseHandler instance', () => {
    handler = new MouseHandler(canvas, container, mockModule);
    expect(handler).toBeInstanceOf(MouseHandler);
  });

  describe('mouse movement', () => {
    it('sends relative deltas on mousemove', () => {
      handler = new MouseHandler(canvas, container, mockModule);
      handler.attach();

      canvas.dispatchEvent(
        createMouseEvent('mousemove', { movementX: 10, movementY: -5 }),
      );

      expect(mockModule._qemu_input_send_mouse).toHaveBeenCalledWith(10, -5, 0, 0);
    });

    it('sends zero deltas for stationary moves', () => {
      handler = new MouseHandler(canvas, container, mockModule);
      handler.attach();

      canvas.dispatchEvent(
        createMouseEvent('mousemove', { movementX: 0, movementY: 0 }),
      );

      expect(mockModule._qemu_input_send_mouse).toHaveBeenCalledWith(0, 0, 0, 0);
    });

    it('sends large delta values', () => {
      handler = new MouseHandler(canvas, container, mockModule);
      handler.attach();

      canvas.dispatchEvent(
        createMouseEvent('mousemove', { movementX: 200, movementY: -150 }),
      );

      expect(mockModule._qemu_input_send_mouse).toHaveBeenCalledWith(200, -150, 0, 0);
    });
  });

  describe('mouse buttons', () => {
    it('sends left button press on mousedown', () => {
      handler = new MouseHandler(canvas, container, mockModule);
      handler.attach();

      canvas.dispatchEvent(
        createMouseEvent('mousedown', { button: 0 }),
      );

      // button=0 is left click, button mask bit 0 = 0x1
      expect(mockModule._qemu_input_send_mouse).toHaveBeenCalledWith(0, 0, 0, 1);
    });

    it('sends right button press on mousedown', () => {
      handler = new MouseHandler(canvas, container, mockModule);
      handler.attach();

      canvas.dispatchEvent(
        createMouseEvent('mousedown', { button: 2 }),
      );

      // button=2 is right click, button mask bit 1 = 0x2
      expect(mockModule._qemu_input_send_mouse).toHaveBeenCalledWith(0, 0, 0, 2);
    });

    it('sends middle button press on mousedown', () => {
      handler = new MouseHandler(canvas, container, mockModule);
      handler.attach();

      canvas.dispatchEvent(
        createMouseEvent('mousedown', { button: 1 }),
      );

      // button=1 is middle click, button mask bit 2 = 0x4
      expect(mockModule._qemu_input_send_mouse).toHaveBeenCalledWith(0, 0, 0, 4);
    });

    it('tracks multiple buttons held simultaneously', () => {
      handler = new MouseHandler(canvas, container, mockModule);
      handler.attach();

      // Press left
      canvas.dispatchEvent(createMouseEvent('mousedown', { button: 0 }));
      expect(mockModule._qemu_input_send_mouse).toHaveBeenLastCalledWith(0, 0, 0, 1);

      // Press right while left still held
      canvas.dispatchEvent(createMouseEvent('mousedown', { button: 2 }));
      expect(mockModule._qemu_input_send_mouse).toHaveBeenLastCalledWith(0, 0, 0, 3); // 0x1 | 0x2

      // Release left
      canvas.dispatchEvent(createMouseEvent('mouseup', { button: 0 }));
      expect(mockModule._qemu_input_send_mouse).toHaveBeenLastCalledWith(0, 0, 0, 2); // only right
    });

    it('releases button on mouseup', () => {
      handler = new MouseHandler(canvas, container, mockModule);
      handler.attach();

      canvas.dispatchEvent(createMouseEvent('mousedown', { button: 0 }));
      canvas.dispatchEvent(createMouseEvent('mouseup', { button: 0 }));

      expect(mockModule._qemu_input_send_mouse).toHaveBeenLastCalledWith(0, 0, 0, 0);
    });

    it('includes button state in mousemove events', () => {
      handler = new MouseHandler(canvas, container, mockModule);
      handler.attach();

      // Press left button
      canvas.dispatchEvent(createMouseEvent('mousedown', { button: 0 }));

      // Move with left button held
      canvas.dispatchEvent(
        createMouseEvent('mousemove', { movementX: 5, movementY: 3 }),
      );

      expect(mockModule._qemu_input_send_mouse).toHaveBeenLastCalledWith(5, 3, 0, 1);
    });
  });

  describe('context menu prevention', () => {
    it('prevents context menu on right-click', () => {
      handler = new MouseHandler(canvas, container, mockModule);
      handler.attach();

      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
      });
      const spy = vi.spyOn(event, 'preventDefault');
      canvas.dispatchEvent(event);

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('detach', () => {
    it('stops forwarding events after detach', () => {
      handler = new MouseHandler(canvas, container, mockModule);
      handler.attach();

      handler.detach();

      canvas.dispatchEvent(
        createMouseEvent('mousemove', { movementX: 10, movementY: 5 }),
      );

      expect(mockModule._qemu_input_send_mouse).not.toHaveBeenCalled();
    });
  });
});
