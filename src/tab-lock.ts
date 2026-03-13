/**
 * tab-lock.ts — Multi-tab safety using Web Locks API.
 *
 * Prevents concurrent access to the disk image from multiple browser tabs.
 * Uses the Web Locks API to acquire an exclusive lock. If the lock is held
 * by another tab, a warning is displayed to the user.
 *
 * Fallback: If Web Locks API is not available, logs a warning but allows
 * the app to proceed (no safety guarantee on older browsers).
 */

/** Result of attempting to acquire a tab lock. */
export type TabLockResult =
  | { acquired: true }
  | { acquired: false; reason: 'held-by-other-tab' }
  | { acquired: false; reason: 'api-unavailable' };

/** Lock name used for the app instance. */
const LOCK_NAME = 'templeossy-instance';

/**
 * Check if the Web Locks API is available.
 */
export function isWebLocksAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    navigator.locks !== undefined &&
    typeof navigator.locks.request === 'function'
  );
}

/**
 * TabLockManager uses the Web Locks API to ensure only one tab
 * is actively writing to the disk image at a time.
 *
 * Usage:
 *   const lock = new TabLockManager();
 *   const result = await lock.acquire();
 *   if (!result.acquired) showWarning();
 *   // ... on cleanup:
 *   lock.release();
 */
export class TabLockManager {
  private _held = false;
  private _releaseCallback: (() => void) | null = null;

  /** Whether this tab currently holds the lock. */
  get isHeld(): boolean {
    return this._held;
  }

  /**
   * Attempt to acquire the exclusive tab lock.
   *
   * Uses Web Locks API with `ifAvailable: true` to check without blocking.
   * If the lock is already held by another tab, returns immediately with
   * `acquired: false`.
   *
   * If the lock is acquired, it is held until release() is called or the
   * tab is closed (browser automatically releases locks on tab close).
   */
  async acquire(): Promise<TabLockResult> {
    if (!isWebLocksAvailable()) {
      return { acquired: false, reason: 'api-unavailable' };
    }

    // Try to acquire without blocking (ifAvailable: true)
    // We use a Promise-based approach: the lock callback receives a resolve
    // function that we store. The lock is held until we call that function.
    return new Promise<TabLockResult>((resolve) => {
      navigator.locks.request(
        LOCK_NAME,
        { ifAvailable: true },
        (lock) => {
          if (lock === null) {
            // Lock is held by another tab
            resolve({ acquired: false, reason: 'held-by-other-tab' });
            return Promise.resolve();
          }

          // We acquired the lock. Return a promise that doesn't resolve
          // until release() is called — this keeps the lock held.
          this._held = true;
          resolve({ acquired: true });

          return new Promise<void>((releaseLock) => {
            this._releaseCallback = releaseLock;
          });
        },
      );
    });
  }

  /**
   * Release the tab lock, allowing other tabs to acquire it.
   */
  release(): void {
    if (this._releaseCallback) {
      this._releaseCallback();
      this._releaseCallback = null;
    }
    this._held = false;
  }
}
