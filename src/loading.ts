/**
 * loading.ts — Loading progress UI controller.
 * Manages the loading overlay, progress bar, and status messages
 * during emulator initialization phases.
 */

import type { EmulatorPhase, EmulatorError } from './emulator';

export interface LoadingElements {
  overlay: HTMLElement;
  progressBar: HTMLElement;
  progressFill: HTMLElement;
  statusText: HTMLElement;
  errorContainer: HTMLElement;
  errorMessage: HTMLElement;
  errorRemediation: HTMLElement;
}

/**
 * Get the status message for a given emulator phase.
 */
export function getStatusMessage(phase: EmulatorPhase): string {
  switch (phase) {
    case 'idle':
      return 'Preparing...';
    case 'downloading':
      return 'Downloading emulator files...';
    case 'compiling':
      return 'Compiling WebAssembly module...';
    case 'initializing':
      return 'Preparing emulator...';
    case 'ready':
      return 'Emulator ready';
    case 'error':
      return 'An error occurred';
    default:
      return '';
  }
}

/**
 * Format download progress as a human-readable string.
 */
export function formatProgress(loaded: number, total: number): string {
  const loadedMB = (loaded / (1024 * 1024)).toFixed(1);
  const totalMB = (total / (1024 * 1024)).toFixed(1);
  const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
  return `Downloading... ${loadedMB} / ${totalMB} MB (${percent}%)`;
}

/**
 * Calculate download progress as a percentage (0-100).
 */
export function calculateProgress(loaded: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((loaded / total) * 100));
}

/**
 * LoadingUI controls the loading overlay and progress display.
 */
export class LoadingUI {
  private elements: LoadingElements;

  constructor(elements: LoadingElements) {
    this.elements = elements;
  }

  /**
   * Update the loading UI based on the current emulator phase.
   */
  updatePhase(phase: EmulatorPhase, error?: EmulatorError): void {
    const { overlay, progressBar, statusText, errorContainer, errorMessage, errorRemediation } =
      this.elements;

    // Reset error state
    errorContainer.classList.add('hidden');

    if (phase === 'ready') {
      // Hide overlay with smooth transition
      overlay.classList.add('fade-out');
      setTimeout(() => {
        overlay.classList.add('hidden');
      }, 500);
      return;
    }

    if (phase === 'error' && error) {
      // Show error
      progressBar.classList.add('hidden');
      errorContainer.classList.remove('hidden');
      errorMessage.textContent = error.message;
      errorRemediation.textContent = error.remediation;
      statusText.textContent = 'Error';
      return;
    }

    // Show overlay and progress
    overlay.classList.remove('hidden', 'fade-out');
    statusText.textContent = getStatusMessage(phase);

    if (phase === 'downloading') {
      progressBar.classList.remove('hidden');
    } else {
      // For compiling/initializing, show indeterminate progress
      progressBar.classList.remove('hidden');
      this.elements.progressFill.style.width = '100%';
      this.elements.progressFill.classList.add('indeterminate');
    }
  }

  /**
   * Update download progress display.
   */
  updateProgress(loaded: number, total: number): void {
    const percent = calculateProgress(loaded, total);
    this.elements.progressFill.style.width = `${percent}%`;
    this.elements.progressFill.classList.remove('indeterminate');
    this.elements.statusText.textContent = formatProgress(loaded, total);
  }

  /**
   * Show the loading overlay with a custom status message.
   * Used to re-show the overlay after it was hidden (e.g., after 'ready' phase)
   * when the user clicks Start and the emulator is booting.
   */
  show(statusMessage: string): void {
    const { overlay, progressBar, progressFill, statusText, errorContainer } = this.elements;

    // Make overlay visible
    overlay.classList.remove('hidden', 'fade-out');

    // Set status text
    statusText.textContent = statusMessage;

    // Show indeterminate progress bar
    progressBar.classList.remove('hidden');
    progressFill.style.width = '100%';
    progressFill.classList.add('indeterminate');

    // Hide any error state
    errorContainer.classList.add('hidden');
  }

  /**
   * Hide the loading overlay with a fade-out transition.
   * Used when the first VGA frame is detected to smoothly transition
   * from the loading overlay to the live display.
   */
  hide(): void {
    const { overlay } = this.elements;
    overlay.classList.add('fade-out');
    setTimeout(() => {
      overlay.classList.add('hidden');
    }, 500);
  }
}
