/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getStatusMessage,
  formatProgress,
  calculateProgress,
  LoadingUI,
  type LoadingElements,
} from './loading';
import type { EmulatorPhase } from './emulator';

describe('getStatusMessage', () => {
  it('returns correct message for idle phase', () => {
    expect(getStatusMessage('idle')).toBe('Preparing...');
  });

  it('returns correct message for downloading phase', () => {
    expect(getStatusMessage('downloading')).toContain('Downloading');
  });

  it('returns correct message for compiling phase', () => {
    expect(getStatusMessage('compiling')).toContain('Compiling');
  });

  it('returns correct message for initializing phase', () => {
    expect(getStatusMessage('initializing')).toContain('Preparing emulator');
  });

  it('returns correct message for ready phase', () => {
    expect(getStatusMessage('ready')).toContain('ready');
  });

  it('returns correct message for error phase', () => {
    expect(getStatusMessage('error')).toContain('error');
  });

  it('returns a non-empty string for all known phases', () => {
    const phases: EmulatorPhase[] = [
      'idle',
      'downloading',
      'compiling',
      'initializing',
      'ready',
      'error',
    ];
    for (const phase of phases) {
      const msg = getStatusMessage(phase);
      expect(msg.length).toBeGreaterThan(0);
    }
  });
});

describe('formatProgress', () => {
  it('formats bytes into MB with percentage', () => {
    const result = formatProgress(5 * 1024 * 1024, 10 * 1024 * 1024);
    expect(result).toContain('5.0');
    expect(result).toContain('10.0');
    expect(result).toContain('50%');
  });

  it('handles zero total', () => {
    const result = formatProgress(0, 0);
    expect(result).toContain('0%');
  });

  it('handles complete download', () => {
    const total = 18129920;
    const result = formatProgress(total, total);
    expect(result).toContain('100%');
  });

  it('handles partial download', () => {
    const result = formatProgress(1024 * 1024, 18 * 1024 * 1024);
    expect(result).toContain('1.0');
    expect(result).toContain('18.0');
  });
});

describe('calculateProgress', () => {
  it('returns 0 for zero total', () => {
    expect(calculateProgress(0, 0)).toBe(0);
  });

  it('returns 0 for negative total', () => {
    expect(calculateProgress(100, -1)).toBe(0);
  });

  it('returns 50 for half done', () => {
    expect(calculateProgress(50, 100)).toBe(50);
  });

  it('returns 100 for complete', () => {
    expect(calculateProgress(100, 100)).toBe(100);
  });

  it('caps at 100', () => {
    expect(calculateProgress(200, 100)).toBe(100);
  });

  it('rounds to nearest integer', () => {
    expect(calculateProgress(1, 3)).toBe(33);
  });
});

describe('LoadingUI', () => {
  let elements: LoadingElements;
  let loadingUI: LoadingUI;

  function createLoadingElements(): LoadingElements {
    const overlay = document.createElement('div');
    overlay.id = 'loading-overlay';

    const progressBar = document.createElement('div');
    progressBar.id = 'progress-bar';

    const progressFill = document.createElement('div');
    progressFill.id = 'progress-fill';

    const statusText = document.createElement('div');
    statusText.id = 'loading-status';

    const errorContainer = document.createElement('div');
    errorContainer.id = 'error-container';
    errorContainer.classList.add('hidden');

    const errorMessage = document.createElement('div');
    errorMessage.id = 'error-message';

    const errorRemediation = document.createElement('div');
    errorRemediation.id = 'error-remediation';

    document.body.appendChild(overlay);

    return {
      overlay,
      progressBar,
      progressFill,
      statusText,
      errorContainer,
      errorMessage,
      errorRemediation,
    };
  }

  beforeEach(() => {
    elements = createLoadingElements();
    loadingUI = new LoadingUI(elements);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('show()', () => {
    it('removes hidden and fade-out classes from overlay', () => {
      // Simulate overlay being hidden (as after 'ready' phase)
      elements.overlay.classList.add('hidden', 'fade-out');

      loadingUI.show('Booting TempleOS...');

      expect(elements.overlay.classList.contains('hidden')).toBe(false);
      expect(elements.overlay.classList.contains('fade-out')).toBe(false);
    });

    it('sets the status text to the provided message', () => {
      loadingUI.show('Booting TempleOS...');

      expect(elements.statusText.textContent).toBe('Booting TempleOS...');
    });

    it('shows progress bar in indeterminate state', () => {
      elements.progressBar.classList.add('hidden');

      loadingUI.show('Booting TempleOS...');

      expect(elements.progressBar.classList.contains('hidden')).toBe(false);
      expect(elements.progressFill.classList.contains('indeterminate')).toBe(true);
      expect(elements.progressFill.style.width).toBe('100%');
    });

    it('hides error container', () => {
      elements.errorContainer.classList.remove('hidden');

      loadingUI.show('Booting...');

      expect(elements.errorContainer.classList.contains('hidden')).toBe(true);
    });
  });

  describe('hide()', () => {
    it('adds fade-out class to overlay', () => {
      // Overlay is visible
      elements.overlay.classList.remove('hidden', 'fade-out');

      loadingUI.hide();

      expect(elements.overlay.classList.contains('fade-out')).toBe(true);
    });

    it('adds hidden class after fade-out delay', async () => {
      elements.overlay.classList.remove('hidden', 'fade-out');

      loadingUI.hide();

      // Immediately after hide(), only fade-out is added
      expect(elements.overlay.classList.contains('fade-out')).toBe(true);
      expect(elements.overlay.classList.contains('hidden')).toBe(false);

      // After 500ms, hidden should be added
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(elements.overlay.classList.contains('hidden')).toBe(true);
    });
  });

  describe('loading indicator gap fix (VAL-DISP-006)', () => {
    it('overlay can be re-shown after being hidden by ready phase', () => {
      // Simulate the normal flow: phase goes to 'ready', hiding the overlay
      loadingUI.updatePhase('ready');

      // Verify overlay is in hidden state
      expect(
        elements.overlay.classList.contains('fade-out') ||
        elements.overlay.classList.contains('hidden'),
      ).toBe(true);

      // Now simulate Start click: re-show overlay with booting message
      loadingUI.show('Booting TempleOS...');

      // Overlay should be visible again
      expect(elements.overlay.classList.contains('hidden')).toBe(false);
      expect(elements.overlay.classList.contains('fade-out')).toBe(false);
      expect(elements.statusText.textContent).toBe('Booting TempleOS...');
    });

    it('overlay hides again when hide() is called (simulating onFirstFrame)', () => {
      // Show overlay for booting
      loadingUI.show('Booting TempleOS...');

      // Simulate first frame detected
      loadingUI.hide();

      expect(elements.overlay.classList.contains('fade-out')).toBe(true);
    });
  });
});
