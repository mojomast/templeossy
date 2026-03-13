/**
 * main.ts — Entry point for TempleOS Browser.
 * Wires together the emulator loader, loading UI, display renderer, debug panel,
 * and controls.
 */

import { EmulatorLoader, checkSharedArrayBuffer, type BootMode } from './emulator';
import { LoadingUI, type LoadingElements } from './loading';
import { DisplayRenderer } from './display';

/** Append a timestamped entry to the debug log. */
function debugLog(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  const logEl = document.getElementById('debug-log');
  if (!logEl) return;

  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  const time = new Date().toLocaleTimeString();
  entry.innerHTML = `<span class="timestamp">[${time}]</span> ${escapeHtml(message)}`;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Determine boot mode from URL query parameter.
 * Default is 'templeos'.
 * Use ?boot=linux-poc to boot the Linux proof-of-concept instead.
 */
function getBootMode(): BootMode {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('boot');
  if (mode === 'linux-poc') return 'linux-poc';
  // Default to TempleOS
  return 'templeos';
}

/** Initialize the application. */
function init(): void {
  const bootMode = getBootMode();

  // Gather loading UI elements
  const loadingElements: LoadingElements = {
    overlay: document.getElementById('loading-overlay')!,
    progressBar: document.getElementById('progress-bar')!,
    progressFill: document.getElementById('progress-fill')!,
    statusText: document.getElementById('loading-status')!,
    errorContainer: document.getElementById('error-container')!,
    errorMessage: document.getElementById('error-message')!,
    errorRemediation: document.getElementById('error-remediation')!,
  };

  const loadingUI = new LoadingUI(loadingElements);

  // Gather control buttons
  const btnStart = document.getElementById('btn-start') as HTMLButtonElement;
  const btnReboot = document.getElementById('btn-reboot') as HTMLButtonElement;
  const btnWipe = document.getElementById('btn-wipe') as HTMLButtonElement;
  const btnFullscreen = document.getElementById('btn-fullscreen') as HTMLButtonElement;
  const btnDebugToggle = document.getElementById('btn-debug-toggle') as HTMLButtonElement;
  const btnDebugClear = document.getElementById('btn-debug-clear') as HTMLButtonElement;
  const debugPanel = document.getElementById('debug-panel')!;
  const canvas = document.getElementById('display') as HTMLCanvasElement;
  const loadingOverlay = document.getElementById('loading-overlay')!;

  // Track display renderer
  let displayRenderer: DisplayRenderer | null = null;

  // Debug panel toggle
  btnDebugToggle.addEventListener('click', () => {
    debugPanel.classList.toggle('hidden');
  });

  btnDebugClear.addEventListener('click', () => {
    const logEl = document.getElementById('debug-log')!;
    logEl.innerHTML = '';
  });

  // Check SharedArrayBuffer first
  debugLog('Checking browser capabilities...');
  const sabError = checkSharedArrayBuffer();
  if (sabError) {
    debugLog(`SharedArrayBuffer not available: ${sabError.message}`, 'error');
    loadingUI.updatePhase('error', sabError);
    return;
  }
  debugLog('SharedArrayBuffer available ✓');

  // Create emulator loader with the selected boot mode
  debugLog(`Boot mode: ${bootMode}`);
  const loader = new EmulatorLoader(bootMode);

  // Wire phase changes to loading UI
  loader.onPhaseChange = (phase, error) => {
    debugLog(`Phase: ${phase}${error ? ` — ${error.message}` : ''}`);
    loadingUI.updatePhase(phase, error);

    if (phase === 'ready') {
      btnStart.disabled = false;
      btnFullscreen.disabled = false;
      debugLog('Emulator ready. Click Start to boot.');
    }

    if (phase === 'error' && error) {
      debugLog(`Error (${error.type}): ${error.message}`, 'error');
      debugLog(`Remediation: ${error.remediation}`, 'warn');
    }
  };

  // Wire download progress
  loader.onDownloadProgress = (loaded, total) => {
    loadingUI.updateProgress(loaded, total);
  };

  // Start loading the emulator
  debugLog('Starting emulator initialization...');
  loader.load().catch((err: unknown) => {
    debugLog(`Unhandled error during load: ${err}`, 'error');
  });

  // Start button — boots the emulator and starts display rendering
  btnStart.addEventListener('click', () => {
    if (!loader.module) {
      debugLog('Module not ready yet', 'warn');
      return;
    }

    debugLog('Starting emulator...');
    btnStart.disabled = true;
    btnReboot.disabled = false;
    btnWipe.disabled = false;

    // Create and start the display renderer
    try {
      displayRenderer = new DisplayRenderer(canvas, loader.module);

      // When first non-blank frame is detected, hide loading overlay
      displayRenderer.onFirstFrame = () => {
        debugLog('First VGA frame detected — display active');
        loadingOverlay.classList.add('fade-out');
        setTimeout(() => {
          loadingOverlay.classList.add('hidden');
        }, 500);
      };

      displayRenderer.start();
      debugLog('Display render loop started (~30 FPS polling)');

      // Focus the canvas for keyboard input
      const container = document.getElementById('display-container');
      container?.focus();

    } catch (err: unknown) {
      debugLog(`Failed to start display: ${err}`, 'error');
    }
  });

  // Reboot button — placeholder
  btnReboot.addEventListener('click', () => {
    debugLog('Reboot clicked — will be implemented in a later feature.');
  });

  // Wipe & Reset button — placeholder
  btnWipe.addEventListener('click', () => {
    debugLog('Wipe & Reset clicked — will be implemented in a later feature.');
  });

  // Fullscreen button
  btnFullscreen.addEventListener('click', () => {
    const container = document.getElementById('display-container');
    if (!container) return;

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {
        debugLog('Failed to exit fullscreen', 'warn');
      });
    } else {
      container.requestFullscreen().catch(() => {
        debugLog('Fullscreen not supported or denied', 'warn');
      });
    }
  });

  // Log display renderer status on cleanup
  window.addEventListener('beforeunload', () => {
    if (displayRenderer) {
      displayRenderer.stop();
    }
  });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
