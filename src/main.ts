/**
 * main.ts — Entry point for TempleOS Browser.
 * Wires together the emulator loader, loading UI, debug panel, and controls.
 */

import { EmulatorLoader, checkSharedArrayBuffer } from './emulator';
import { LoadingUI, type LoadingElements } from './loading';

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

/** Initialize the application. */
function init(): void {
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

  // Create emulator loader
  const loader = new EmulatorLoader();

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

  // Start button — placeholder logic (actual boot in later feature)
  btnStart.addEventListener('click', () => {
    debugLog('Start clicked — emulator boot will be implemented in a later feature.');
    btnStart.disabled = true;
    btnReboot.disabled = false;
    btnWipe.disabled = false;
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
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
