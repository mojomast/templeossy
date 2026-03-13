/**
 * main.ts — Entry point for TempleOS Browser.
 * Wires together the emulator loader, loading UI, display renderer,
 * controls manager, debug panel, and input handlers.
 *
 * Persistence is currently disabled (PERSISTENCE_ENABLED = false).
 * Shrine boots as a live CD with no writable disk.
 */

import { EmulatorLoader, checkSharedArrayBuffer, type BootMode } from './emulator';
import { LoadingUI, type LoadingElements } from './loading';
import { DisplayRenderer } from './display';
import { KeyboardHandler } from './input';
import { MouseHandler } from './mouse';
import { ControlsManager, DebugLogger, type ControlElements } from './controls';
// Persistence imports kept for future re-enablement
import {
  DiskStorage as _DiskStorage,
  AutoSaveManager as _AutoSaveManager,
  selectBootMedium as _selectBootMedium,
  getBootOrderFlag as _getBootOrderFlag,
  type BootMedium as _BootMedium,
} from './storage';
import { TabLockManager as _TabLockManager } from './tab-lock';

// Suppress unused-import warnings
void _DiskStorage; void _AutoSaveManager; void _selectBootMedium;
void _getBootOrderFlag; void _TabLockManager;

/** Master flag — set to true to re-enable disk persistence and tab locking. */
const PERSISTENCE_ENABLED = false;

/**
 * Determine boot mode from URL query parameter.
 * Default is 'templeos'.
 * Use ?boot=linux-poc to boot the Linux proof-of-concept instead.
 */
function getBootMode(): BootMode {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('boot');
  if (mode === 'linux-poc') return 'linux-poc';
  return 'templeos';
}

/**
 * Show the resume choice dialog and wait for user to select an option.
 * Returns 'resume' or 'fresh'.
 * (Unused while PERSISTENCE_ENABLED is false.)
 */
export function showResumeDialog(): Promise<'resume' | 'fresh'> {
  return new Promise((resolve) => {
    const dialog = document.getElementById('resume-dialog')!;
    const btnResume = document.getElementById('btn-resume') as HTMLButtonElement;
    const btnFresh = document.getElementById('btn-fresh') as HTMLButtonElement;

    dialog.classList.remove('hidden');

    const cleanup = (): void => {
      dialog.classList.add('hidden');
      btnResume.removeEventListener('click', onResume);
      btnFresh.removeEventListener('click', onFresh);
    };

    const onResume = (): void => {
      cleanup();
      resolve('resume');
    };

    const onFresh = (): void => {
      cleanup();
      resolve('fresh');
    };

    btnResume.addEventListener('click', onResume);
    btnFresh.addEventListener('click', onFresh);
  });
}

/**
 * Show the multi-tab warning overlay.
 */
function showMultiTabWarning(): void {
  const warning = document.getElementById('multi-tab-warning');
  if (warning) {
    warning.classList.remove('hidden');
  }
}

/**
 * Show a storage notification toast.
 * (Unused while PERSISTENCE_ENABLED is false.)
 */
export function showStorageToast(message: string): void {
  const toast = document.getElementById('storage-toast');
  const toastMessage = document.getElementById('storage-toast-message');
  const toastClose = document.getElementById('storage-toast-close');

  if (toast && toastMessage) {
    toastMessage.textContent = message;
    toast.classList.remove('hidden');

    // Auto-hide after 15 seconds
    const autoHide = setTimeout(() => {
      toast.classList.add('hidden');
    }, 15_000);

    // Close button
    if (toastClose) {
      const closeHandler = (): void => {
        clearTimeout(autoHide);
        toast.classList.add('hidden');
        toastClose.removeEventListener('click', closeHandler);
      };
      toastClose.addEventListener('click', closeHandler);
    }
  }
}

/** Initialize the application. */
async function init(): Promise<void> {
  const bootMode = getBootMode();

  // ─── Multi-tab safety: acquire tab lock (disabled without persistence) ─
  let tabLockUnavailable = false;
  if (PERSISTENCE_ENABLED) {
    const tabLock = new _TabLockManager();
    const lockResult = await tabLock.acquire();

    if (!lockResult.acquired && lockResult.reason === 'held-by-other-tab') {
      showMultiTabWarning();
      return;
    }

    tabLockUnavailable = !lockResult.acquired && lockResult.reason === 'api-unavailable';
  }

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

  // Gather DOM elements
  const canvas = document.getElementById('display') as HTMLCanvasElement;
  const displayContainer = document.getElementById('display-container')!;
  const debugPanel = document.getElementById('debug-panel')!;
  const debugLogEl = document.getElementById('debug-log')!;
  const btnDebugToggle = document.getElementById('btn-debug-toggle') as HTMLButtonElement;
  const btnDebugClear = document.getElementById('btn-debug-clear') as HTMLButtonElement;

  // Gather control button elements
  const controlElements: ControlElements = {
    btnStart: document.getElementById('btn-start') as HTMLButtonElement,
    btnReboot: document.getElementById('btn-reboot') as HTMLButtonElement,
    btnWipe: document.getElementById('btn-wipe') as HTMLButtonElement,
    btnFullscreen: document.getElementById('btn-fullscreen') as HTMLButtonElement,
    btnExitFullscreen: document.getElementById('btn-exit-fullscreen') as HTMLButtonElement,
    displayContainer,
    canvas,
  };

  // Create debug logger
  const debugLog = new DebugLogger(debugLogEl);

  // Track display renderer and input handlers
  let displayRenderer: DisplayRenderer | null = null;
  let keyboardHandler: KeyboardHandler | null = null;
  let mouseHandler: MouseHandler | null = null;
  let loader: EmulatorLoader | null = null;

  // Log tab lock status
  if (PERSISTENCE_ENABLED) {
    if (tabLockUnavailable) {
      debugLog.log('Web Locks API unavailable — multi-tab protection disabled', 'warn');
    } else {
      debugLog.log('Tab lock acquired ✓');
    }
  } else {
    debugLog.log('Persistence disabled — running as live CD');
  }

  debugLog.log('Boot medium: cd (CD-ROM)');

  // Capture Emscripten stdout/stderr to debug log
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  console.log = (...args: unknown[]) => {
    originalConsoleLog(...args);
    const msg = args.map(String).join(' ');
    if (msg.startsWith('[QEMU]')) {
      debugLog.log(msg, 'info');
    }
  };
  console.warn = (...args: unknown[]) => {
    originalConsoleWarn(...args);
    const msg = args.map(String).join(' ');
    if (msg.startsWith('[QEMU]')) {
      debugLog.log(msg, 'warn');
    }
  };

  // Debug panel toggle
  btnDebugToggle.addEventListener('click', () => {
    debugPanel.classList.toggle('hidden');
  });

  btnDebugClear.addEventListener('click', () => {
    debugLog.clear();
  });

  /**
   * Start the emulator: create display renderer and input handlers.
   */
  function startEmulator(): void {
    if (!loader?.module) {
      debugLog.log('Module not ready yet', 'warn');
      return;
    }

    debugLog.log('Starting emulator...');
    controls.setState('running');

    // Re-show loading overlay with booting message to bridge the gap
    // between Start click and first VGA frame (fixes VAL-DISP-006)
    loadingUI.show('Booting Shrine...');

    try {
      displayRenderer = new DisplayRenderer(canvas, loader.module);
      displayRenderer.onDiagnostic = (message: string) => {
        debugLog.log(`[display] ${message}`);
      };

      // When first non-blank frame is detected, hide loading overlay
      displayRenderer.onFirstFrame = () => {
        debugLog.log('First VGA frame detected — display active');
        loadingUI.hide();
      };

      displayRenderer.start();
      debugLog.log('Display render loop started (~30 FPS polling)');

      // Set up keyboard input handler on the display container
      keyboardHandler = new KeyboardHandler(displayContainer, loader.module);
      keyboardHandler.onDiagnostic = (message: string) => {
        debugLog.log(`[keyboard] ${message}`);
      };
      keyboardHandler.attach();
      debugLog.log('Keyboard input handler attached');

      // Set up mouse input handler on the canvas
      mouseHandler = new MouseHandler(canvas, displayContainer, loader.module);
      mouseHandler.attach();
      debugLog.log('Mouse input handler attached');

      // Focus the container for keyboard input
      displayContainer.focus();
    } catch (err: unknown) {
      debugLog.log(`Failed to start display: ${err}`, 'error');
      controls.setState('error');
    }
  }

  /**
   * Reboot the emulator: perform a QEMU system reset (hard reboot).
   * Disk image is preserved.
   */
  function rebootEmulator(): void {
    if (!loader?.module) return;

    debugLog.log('Rebooting emulator...');

    try {
      // Call QEMU system reset if available
      if (typeof loader.module._qemu_system_reset === 'function') {
        loader.module._qemu_system_reset();
        debugLog.log('QEMU system reset performed — TempleOS will reboot');
      } else {
        debugLog.log('QEMU system reset not available — reloading page', 'warn');
        window.location.reload();
      }
    } catch (err: unknown) {
      debugLog.log(`Reboot failed: ${err}`, 'error');
    }
  }

  /**
   * Wipe & Reset: reload the page for a fresh start.
   * With persistence disabled this simply reloads.
   */
  function wipeAndReset(): void {
    debugLog.log('Wipe & Reset — restarting...');
    window.location.reload();
  }

  // Create controls manager with callbacks
  const controls = new ControlsManager(controlElements, {
    onStart: startEmulator,
    onReboot: rebootEmulator,
    onWipe: wipeAndReset,
  });

  // Check SharedArrayBuffer first
  debugLog.log('Checking browser capabilities...');
  const sabError = checkSharedArrayBuffer();
  if (sabError) {
    debugLog.log(`SharedArrayBuffer not available: ${sabError.message}`, 'error');
    loadingUI.updatePhase('error', sabError);
    controls.setState('error');
    return;
  }
  debugLog.log('SharedArrayBuffer available ✓');

  // Create emulator loader with the selected boot mode
  debugLog.log(`Boot mode: ${bootMode}`);
  loader = new EmulatorLoader(bootMode);

  // Always boot from CD (Shrine live CD, persistence disabled)
  if (bootMode === 'templeos') {
    loader.bootOrder = 'd';
    debugLog.log('Boot order: d (CD-ROM)');
  }

  // Wire phase changes to loading UI and controls
  loader.onPhaseChange = (phase, error) => {
    debugLog.log(`Phase: ${phase}${error ? ` — ${error.message}` : ''}`);
    loadingUI.updatePhase(phase, error);

    if (phase === 'ready') {
      controls.setState('ready');
      debugLog.log('Emulator ready. Click Start to boot.');
    }

    if (phase === 'error' && error) {
      controls.setState('error');
      debugLog.log(`Error (${error.type}): ${error.message}`, 'error');
      debugLog.log(`Remediation: ${error.remediation}`, 'warn');
    }
  };

  // Wire download progress
  loader.onDownloadProgress = (loaded, total) => {
    loadingUI.updateProgress(loaded, total);
  };

  // Start loading the emulator
  debugLog.log('Starting emulator initialization...');
  loader.load().catch((err: unknown) => {
    debugLog.log(`Unhandled error during load: ${err}`, 'error');
  });

  // Clean up on unload
  window.addEventListener('beforeunload', () => {
    if (keyboardHandler) {
      keyboardHandler.detach();
    }
    if (mouseHandler) {
      mouseHandler.detach();
    }
    if (displayRenderer) {
      displayRenderer.stop();
    }
    controls.destroy();
  });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { void init(); });
} else {
  void init();
}
