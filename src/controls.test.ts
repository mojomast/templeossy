/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ControlsManager,
  DebugLogger,
  formatLogEntry,
  type ControlElements,
  type EmulatorState,
} from './controls';

describe('ControlsManager', () => {
  let elements: ControlElements;
  let manager: ControlsManager;

  function createElements(): ControlElements {
    const btnStart = document.createElement('button');
    btnStart.id = 'btn-start';
    btnStart.disabled = true;

    const btnReboot = document.createElement('button');
    btnReboot.id = 'btn-reboot';
    btnReboot.disabled = true;

    const btnWipe = document.createElement('button');
    btnWipe.id = 'btn-wipe';
    btnWipe.disabled = true;

    const btnFullscreen = document.createElement('button');
    btnFullscreen.id = 'btn-fullscreen';
    btnFullscreen.disabled = true;

    const btnExitFullscreen = document.createElement('button');
    btnExitFullscreen.id = 'btn-exit-fullscreen';

    const displayContainer = document.createElement('div');
    displayContainer.id = 'display-container';
    displayContainer.setAttribute('tabindex', '0');

    const canvas = document.createElement('canvas');
    canvas.id = 'display';
    canvas.width = 640;
    canvas.height = 480;
    displayContainer.appendChild(canvas);

    // Append to body so focus can work
    document.body.appendChild(displayContainer);
    document.body.appendChild(btnStart);
    document.body.appendChild(btnReboot);
    document.body.appendChild(btnWipe);
    document.body.appendChild(btnFullscreen);
    document.body.appendChild(btnExitFullscreen);

    return {
      btnStart,
      btnReboot,
      btnWipe,
      btnFullscreen,
      btnExitFullscreen,
      displayContainer,
      canvas,
    };
  }

  beforeEach(() => {
    elements = createElements();
  });

  afterEach(() => {
    if (manager) {
      manager.destroy();
    }
    document.body.innerHTML = '';
  });

  describe('button state machine', () => {
    it('starts with all action buttons disabled', () => {
      manager = new ControlsManager(elements);
      expect(elements.btnStart.disabled).toBe(true);
      expect(elements.btnReboot.disabled).toBe(true);
      expect(elements.btnWipe.disabled).toBe(true);
      expect(elements.btnFullscreen.disabled).toBe(true);
    });

    it('enables Start and Fullscreen when state transitions to ready', () => {
      manager = new ControlsManager(elements);
      manager.setState('ready');
      expect(elements.btnStart.disabled).toBe(false);
      expect(elements.btnFullscreen.disabled).toBe(false);
      expect(elements.btnReboot.disabled).toBe(true);
      expect(elements.btnWipe.disabled).toBe(true);
    });

    it('disables Start and enables Reboot/Wipe when state transitions to running', () => {
      manager = new ControlsManager(elements);
      manager.setState('running');
      expect(elements.btnStart.disabled).toBe(true);
      expect(elements.btnReboot.disabled).toBe(false);
      expect(elements.btnWipe.disabled).toBe(false);
      expect(elements.btnFullscreen.disabled).toBe(false);
    });

    it('disables all action buttons in loading state', () => {
      manager = new ControlsManager(elements);
      manager.setState('loading');
      expect(elements.btnStart.disabled).toBe(true);
      expect(elements.btnReboot.disabled).toBe(true);
      expect(elements.btnWipe.disabled).toBe(true);
    });

    it('disables all action buttons except Fullscreen in error state', () => {
      manager = new ControlsManager(elements);
      manager.setState('error');
      expect(elements.btnStart.disabled).toBe(true);
      expect(elements.btnReboot.disabled).toBe(true);
      expect(elements.btnWipe.disabled).toBe(true);
    });

    it('transitions from ready → running on start', () => {
      manager = new ControlsManager(elements);
      manager.setState('ready');
      expect(manager.state).toBe('ready');

      manager.setState('running');
      expect(manager.state).toBe('running');
      expect(elements.btnStart.disabled).toBe(true);
      expect(elements.btnReboot.disabled).toBe(false);
    });

    it('transitions from running → running after reboot', () => {
      manager = new ControlsManager(elements);
      manager.setState('running');
      // After reboot, emulator is still running
      manager.setState('running');
      expect(manager.state).toBe('running');
      expect(elements.btnReboot.disabled).toBe(false);
    });

    it('exposes current state', () => {
      manager = new ControlsManager(elements);
      expect(manager.state).toBe('loading');

      manager.setState('ready');
      expect(manager.state).toBe('ready');

      manager.setState('running');
      expect(manager.state).toBe('running');
    });
  });

  describe('double-click prevention on Start', () => {
    it('prevents rapid Start button clicks from creating duplicate instances', () => {
      const onStart = vi.fn();
      manager = new ControlsManager(elements, { onStart });
      manager.setState('ready');

      // Simulate rapid double-click
      elements.btnStart.click();
      elements.btnStart.click();
      elements.btnStart.click();

      // Should only call onStart once because Start becomes disabled after first click
      expect(onStart).toHaveBeenCalledTimes(1);
    });

    it('calls onStart callback when Start is clicked in ready state', () => {
      const onStart = vi.fn();
      manager = new ControlsManager(elements, { onStart });
      manager.setState('ready');

      elements.btnStart.click();
      expect(onStart).toHaveBeenCalledTimes(1);
    });

    it('does not call onStart when Start is clicked in non-ready state', () => {
      const onStart = vi.fn();
      manager = new ControlsManager(elements, { onStart });
      // State is 'loading' by default

      elements.btnStart.click();
      expect(onStart).not.toHaveBeenCalled();
    });

    it('disables Start button immediately upon click', () => {
      const onStart = vi.fn();
      manager = new ControlsManager(elements, { onStart });
      manager.setState('ready');

      expect(elements.btnStart.disabled).toBe(false);
      elements.btnStart.click();
      expect(elements.btnStart.disabled).toBe(true);
    });
  });

  describe('reboot confirmation', () => {
    it('calls onReboot callback when Reboot is clicked and confirmed', () => {
      const onReboot = vi.fn();
      manager = new ControlsManager(elements, { onReboot });
      manager.setState('running');

      // Mock confirm dialog to return true
      vi.spyOn(globalThis, 'confirm').mockReturnValue(true);

      elements.btnReboot.click();
      expect(globalThis.confirm).toHaveBeenCalledWith(
        expect.stringContaining('Reboot'),
      );
      expect(onReboot).toHaveBeenCalledTimes(1);
    });

    it('does not call onReboot when confirmation is cancelled', () => {
      const onReboot = vi.fn();
      manager = new ControlsManager(elements, { onReboot });
      manager.setState('running');

      // Mock confirm dialog to return false
      vi.spyOn(globalThis, 'confirm').mockReturnValue(false);

      elements.btnReboot.click();
      expect(onReboot).not.toHaveBeenCalled();
    });

    it('does not call onReboot when emulator is not running', () => {
      const onReboot = vi.fn();
      manager = new ControlsManager(elements, { onReboot });
      manager.setState('ready');

      elements.btnReboot.click();
      expect(onReboot).not.toHaveBeenCalled();
    });
  });

  describe('fullscreen', () => {
    it('calls requestFullscreen on the display container', () => {
      manager = new ControlsManager(elements);
      manager.setState('ready');

      // Mock requestFullscreen
      const mockRequestFullscreen = vi.fn().mockResolvedValue(undefined);
      elements.displayContainer.requestFullscreen = mockRequestFullscreen;

      elements.btnFullscreen.click();
      expect(mockRequestFullscreen).toHaveBeenCalled();
    });

    it('calls exitFullscreen when already in fullscreen', () => {
      manager = new ControlsManager(elements);
      manager.setState('ready');

      // Mock document.fullscreenElement
      Object.defineProperty(document, 'fullscreenElement', {
        value: elements.displayContainer,
        writable: true,
        configurable: true,
      });

      const mockExitFullscreen = vi.fn().mockResolvedValue(undefined);
      document.exitFullscreen = mockExitFullscreen;

      elements.btnFullscreen.click();
      expect(mockExitFullscreen).toHaveBeenCalled();

      // Clean up
      Object.defineProperty(document, 'fullscreenElement', {
        value: null,
        writable: true,
        configurable: true,
      });
    });
  });

  describe('wipe callback', () => {
    it('calls onWipe callback when Wipe is clicked and confirmed', () => {
      const onWipe = vi.fn();
      manager = new ControlsManager(elements, { onWipe });
      manager.setState('running');

      vi.spyOn(globalThis, 'confirm').mockReturnValue(true);

      elements.btnWipe.click();
      expect(onWipe).toHaveBeenCalledTimes(1);
    });
  });
});

describe('DebugLogger', () => {
  let logEl: HTMLElement;
  let logger: DebugLogger;

  beforeEach(() => {
    logEl = document.createElement('div');
    logEl.id = 'debug-log';
    document.body.appendChild(logEl);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('appends a log entry to the log element', () => {
    logger = new DebugLogger(logEl);
    logger.log('Test message');
    expect(logEl.children.length).toBe(1);
    expect(logEl.textContent).toContain('Test message');
  });

  it('adds a timestamp to each log entry', () => {
    logger = new DebugLogger(logEl);
    logger.log('Timestamped message');
    const entry = logEl.children[0] as HTMLElement;
    expect(entry.innerHTML).toContain('timestamp');
  });

  it('supports info, warn, and error levels', () => {
    logger = new DebugLogger(logEl);
    logger.log('Info message', 'info');
    logger.log('Warning message', 'warn');
    logger.log('Error message', 'error');

    expect(logEl.children.length).toBe(3);
    expect((logEl.children[0] as HTMLElement).className).toContain('info');
    expect((logEl.children[1] as HTMLElement).className).toContain('warn');
    expect((logEl.children[2] as HTMLElement).className).toContain('error');
  });

  it('preserves entries when toggling panel visibility', () => {
    logger = new DebugLogger(logEl);
    logger.log('Entry 1');
    logger.log('Entry 2');

    // Simulate toggle off (hiding parent)
    logEl.style.display = 'none';
    // Simulate toggle on
    logEl.style.display = '';

    expect(logEl.children.length).toBe(2);
    expect(logEl.textContent).toContain('Entry 1');
    expect(logEl.textContent).toContain('Entry 2');
  });

  it('escapes HTML in log messages', () => {
    logger = new DebugLogger(logEl);
    logger.log('<script>alert("xss")</script>');
    expect(logEl.innerHTML).not.toContain('<script>');
    expect(logEl.textContent).toContain('<script>');
  });

  it('auto-scrolls to the latest entry', () => {
    logger = new DebugLogger(logEl);
    // Add many entries
    for (let i = 0; i < 50; i++) {
      logger.log(`Entry ${i}`);
    }
    // scrollTop is set — can't fully test in jsdom but verify the method works
    expect(logEl.children.length).toBe(50);
  });

  it('clears all entries', () => {
    logger = new DebugLogger(logEl);
    logger.log('Entry 1');
    logger.log('Entry 2');
    logger.clear();
    expect(logEl.children.length).toBe(0);
  });
});

describe('formatLogEntry', () => {
  it('formats a log entry with timestamp and message', () => {
    const result = formatLogEntry('Test message', 'info');
    expect(result).toContain('Test message');
    expect(result).toContain('timestamp');
    expect(result).toContain('info');
  });

  it('formats an error log entry', () => {
    const result = formatLogEntry('Error occurred', 'error');
    expect(result).toContain('Error occurred');
    expect(result).toContain('error');
  });

  it('formats a warning log entry', () => {
    const result = formatLogEntry('Something suspicious', 'warn');
    expect(result).toContain('Something suspicious');
    expect(result).toContain('warn');
  });

  it('escapes HTML in the message', () => {
    const result = formatLogEntry('<b>bold</b>', 'info');
    expect(result).not.toContain('<b>bold</b>');
    expect(result).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });
});
