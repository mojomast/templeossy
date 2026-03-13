/**
 * controls.ts — UI controls state machine for TempleOS Browser.
 *
 * Manages Start, Reboot, Wipe & Reset, and Fullscreen button states
 * through the emulator lifecycle. Provides a DebugLogger for timestamped
 * log entries in the debug panel.
 *
 * State machine:
 *   loading → ready → running → (running after reboot)
 *                  ↘ error
 *
 * Button enable/disable rules:
 *   loading:  all disabled
 *   ready:    Start ✓, Reboot ✗, Wipe ✗, Fullscreen ✓
 *   running:  Start ✗, Reboot ✓, Wipe ✓, Fullscreen ✓
 *   error:    all disabled
 */

/** Emulator lifecycle states. */
export type EmulatorState = 'loading' | 'ready' | 'running' | 'error';

/** DOM elements required by the controls manager. */
export interface ControlElements {
  btnStart: HTMLButtonElement;
  btnReboot: HTMLButtonElement;
  btnWipe: HTMLButtonElement;
  btnFullscreen: HTMLButtonElement;
  btnExitFullscreen: HTMLButtonElement;
  displayContainer: HTMLElement;
  canvas: HTMLCanvasElement;
}

/** Callbacks for control actions. */
export interface ControlCallbacks {
  onStart?: () => void;
  onReboot?: () => void;
  onWipe?: () => void;
}

/**
 * Escape HTML special characters to prevent XSS in debug log entries.
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Format a debug log entry as an HTML string with timestamp and level class.
 */
export function formatLogEntry(
  message: string,
  level: 'info' | 'warn' | 'error' = 'info',
): string {
  const time = new Date().toLocaleTimeString();
  return `<div class="log-entry ${level}"><span class="timestamp">[${time}]</span> ${escapeHtml(message)}</div>`;
}

/**
 * DebugLogger manages timestamped log entries in a debug panel element.
 * Toggling the panel's visibility preserves all existing entries.
 */
export class DebugLogger {
  private logEl: HTMLElement;

  constructor(logEl: HTMLElement) {
    this.logEl = logEl;
  }

  /** Append a timestamped log entry. */
  log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    const entry = document.createElement('div');
    entry.className = `log-entry ${level}`;
    const time = new Date().toLocaleTimeString();
    entry.innerHTML = `<span class="timestamp">[${time}]</span> ${escapeHtml(message)}`;
    this.logEl.appendChild(entry);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  /** Clear all log entries. */
  clear(): void {
    this.logEl.innerHTML = '';
  }
}

/**
 * ControlsManager manages button states through the emulator lifecycle
 * and wires up click handlers with double-click protection.
 */
export class ControlsManager {
  private _state: EmulatorState = 'loading';
  private elements: ControlElements;
  private callbacks: ControlCallbacks;
  private _startClicked = false;

  /** Bound event handlers for cleanup. */
  private boundStartClick: (() => void) | null = null;
  private boundRebootClick: (() => void) | null = null;
  private boundWipeClick: (() => void) | null = null;
  private boundFullscreenClick: (() => void) | null = null;
  private boundExitFullscreenClick: (() => void) | null = null;
  private boundFullscreenChange: (() => void) | null = null;

  constructor(elements: ControlElements, callbacks: ControlCallbacks = {}) {
    this.elements = elements;
    this.callbacks = callbacks;

    // Apply initial state
    this.applyButtonStates();

    // Wire up event handlers
    this.boundStartClick = this.handleStartClick.bind(this);
    this.boundRebootClick = this.handleRebootClick.bind(this);
    this.boundWipeClick = this.handleWipeClick.bind(this);
    this.boundFullscreenClick = this.handleFullscreenClick.bind(this);
    this.boundExitFullscreenClick = this.handleExitFullscreenClick.bind(this);
    this.boundFullscreenChange = this.handleFullscreenChange.bind(this);

    elements.btnStart.addEventListener('click', this.boundStartClick);
    elements.btnReboot.addEventListener('click', this.boundRebootClick);
    elements.btnWipe.addEventListener('click', this.boundWipeClick);
    elements.btnFullscreen.addEventListener('click', this.boundFullscreenClick);
    elements.btnExitFullscreen.addEventListener('click', this.boundExitFullscreenClick);
    document.addEventListener('fullscreenchange', this.boundFullscreenChange);
  }

  get state(): EmulatorState {
    return this._state;
  }

  /** Transition to a new state and update button enabled/disabled. */
  setState(newState: EmulatorState): void {
    this._state = newState;

    // Reset start-clicked flag when transitioning to ready (allows re-enabling start)
    if (newState === 'ready') {
      this._startClicked = false;
    }

    this.applyButtonStates();
  }

  /** Apply button enabled/disabled states based on the current lifecycle state. */
  private applyButtonStates(): void {
    const { btnStart, btnReboot, btnWipe, btnFullscreen } = this.elements;

    switch (this._state) {
      case 'loading':
        btnStart.disabled = true;
        btnReboot.disabled = true;
        btnWipe.disabled = true;
        btnFullscreen.disabled = true;
        break;

      case 'ready':
        btnStart.disabled = this._startClicked;
        btnReboot.disabled = true;
        btnWipe.disabled = true;
        btnFullscreen.disabled = false;
        break;

      case 'running':
        btnStart.disabled = true;
        btnReboot.disabled = false;
        btnWipe.disabled = false;
        btnFullscreen.disabled = false;
        break;

      case 'error':
        btnStart.disabled = true;
        btnReboot.disabled = true;
        btnWipe.disabled = true;
        btnFullscreen.disabled = true;
        break;
    }
  }

  /** Handle Start button click with double-click protection. */
  private handleStartClick(): void {
    if (this._state !== 'ready' || this._startClicked) return;

    this._startClicked = true;
    this.elements.btnStart.disabled = true;
    this.callbacks.onStart?.();
  }

  /** Handle Reboot button click with confirmation dialog. */
  private handleRebootClick(): void {
    if (this._state !== 'running') return;

    const confirmed = confirm(
      'Reboot the emulator? Disk data will be preserved.',
    );
    if (!confirmed) return;

    this.callbacks.onReboot?.();
  }

  /** Handle Wipe & Reset button click with confirmation dialog. */
  private handleWipeClick(): void {
    if (this._state !== 'running') return;

    const confirmed = confirm(
      'This will delete all saved data and start fresh. Are you sure?',
    );
    if (!confirmed) return;

    this.callbacks.onWipe?.();
  }

  /** Handle Fullscreen button click. */
  private handleFullscreenClick(): void {
    const container = this.elements.displayContainer;

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {
        // Fullscreen exit failed — likely not in fullscreen
      });
    } else {
      container.requestFullscreen().catch(() => {
        // Fullscreen not supported or denied
      });
    }
  }

  /** Handle Exit Fullscreen button click (visible in fullscreen mode). */
  private handleExitFullscreenClick(): void {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {
        // Fullscreen exit failed
      });
    }
  }

  /** Handle fullscreenchange event to update exit button visibility. */
  private handleFullscreenChange(): void {
    const isFullscreen = !!document.fullscreenElement;
    this.elements.btnExitFullscreen.classList.toggle('hidden', !isFullscreen);
  }

  /** Clean up event listeners. */
  destroy(): void {
    if (this.boundStartClick) {
      this.elements.btnStart.removeEventListener('click', this.boundStartClick);
    }
    if (this.boundRebootClick) {
      this.elements.btnReboot.removeEventListener('click', this.boundRebootClick);
    }
    if (this.boundWipeClick) {
      this.elements.btnWipe.removeEventListener('click', this.boundWipeClick);
    }
    if (this.boundFullscreenClick) {
      this.elements.btnFullscreen.removeEventListener('click', this.boundFullscreenClick);
    }
    if (this.boundExitFullscreenClick) {
      this.elements.btnExitFullscreen.removeEventListener('click', this.boundExitFullscreenClick);
    }
    if (this.boundFullscreenChange) {
      document.removeEventListener('fullscreenchange', this.boundFullscreenChange);
    }
  }
}
