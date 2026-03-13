/**
 * @vitest-environment jsdom
 */

/**
 * tab-lock.test.ts — Tests for multi-tab safety via Web Locks API.
 *
 * Tests cover:
 * - Web Locks API availability detection
 * - Lock acquisition (success and failure)
 * - Lock release
 * - API unavailable fallback
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { isWebLocksAvailable, TabLockManager, type TabLockResult } from './tab-lock';

// ─── isWebLocksAvailable ───────────────────────────────────────────────────

describe('isWebLocksAvailable', () => {
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  it('returns true when navigator.locks.request is available', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        locks: {
          request: vi.fn(),
          query: vi.fn(),
        },
      },
      configurable: true,
      writable: true,
    });

    expect(isWebLocksAvailable()).toBe(true);
  });

  it('returns false when navigator.locks is undefined', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
      writable: true,
    });

    expect(isWebLocksAvailable()).toBe(false);
  });

  it('returns false when navigator is undefined', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    expect(isWebLocksAvailable()).toBe(false);
  });

  it('returns false when navigator.locks.request is not a function', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        locks: {
          request: 'not a function',
        },
      },
      configurable: true,
      writable: true,
    });

    expect(isWebLocksAvailable()).toBe(false);
  });
});

// ─── TabLockManager ────────────────────────────────────────────────────────

describe('TabLockManager', () => {
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  it('starts with isHeld = false', () => {
    const manager = new TabLockManager();
    expect(manager.isHeld).toBe(false);
  });

  it('returns api-unavailable when Web Locks API is not available', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
      writable: true,
    });

    const manager = new TabLockManager();
    const result = await manager.acquire();
    expect(result.acquired).toBe(false);
    if (!result.acquired) {
      expect(result.reason).toBe('api-unavailable');
    }
    expect(manager.isHeld).toBe(false);
  });

  it('acquires lock successfully when lock is available', async () => {
    // Mock Web Locks API - lock is available (callback receives lock object)
    const mockRequest = vi.fn(
      (
        _name: string,
        _options: { ifAvailable: boolean },
        callback: (lock: unknown) => Promise<void>,
      ) => {
        // Simulate lock acquired — pass a non-null lock object
        void callback({ name: 'templeossy-instance', mode: 'exclusive' });
      },
    );

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        locks: {
          request: mockRequest,
        },
      },
      configurable: true,
      writable: true,
    });

    const manager = new TabLockManager();
    const result = await manager.acquire();
    expect(result.acquired).toBe(true);
    expect(manager.isHeld).toBe(true);

    // Clean up
    manager.release();
    expect(manager.isHeld).toBe(false);
  });

  it('returns held-by-other-tab when lock is not available', async () => {
    // Mock Web Locks API - lock not available (callback receives null)
    const mockRequest = vi.fn(
      (
        _name: string,
        _options: { ifAvailable: boolean },
        callback: (lock: null) => Promise<void>,
      ) => {
        // Simulate lock not acquired — pass null
        void callback(null);
      },
    );

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        locks: {
          request: mockRequest,
        },
      },
      configurable: true,
      writable: true,
    });

    const manager = new TabLockManager();
    const result = await manager.acquire();
    expect(result.acquired).toBe(false);
    if (!result.acquired) {
      expect(result.reason).toBe('held-by-other-tab');
    }
    expect(manager.isHeld).toBe(false);
  });

  it('release() sets isHeld to false', async () => {
    const mockRequest = vi.fn(
      (
        _name: string,
        _options: { ifAvailable: boolean },
        callback: (lock: unknown) => Promise<void>,
      ) => {
        void callback({ name: 'templeossy-instance', mode: 'exclusive' });
      },
    );

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        locks: {
          request: mockRequest,
        },
      },
      configurable: true,
      writable: true,
    });

    const manager = new TabLockManager();
    await manager.acquire();
    expect(manager.isHeld).toBe(true);

    manager.release();
    expect(manager.isHeld).toBe(false);
  });

  it('release() is safe to call when not held', () => {
    const manager = new TabLockManager();
    // Should not throw
    manager.release();
    expect(manager.isHeld).toBe(false);
  });

  it('release() is idempotent — calling twice is safe', async () => {
    const mockRequest = vi.fn(
      (
        _name: string,
        _options: { ifAvailable: boolean },
        callback: (lock: unknown) => Promise<void>,
      ) => {
        void callback({ name: 'templeossy-instance', mode: 'exclusive' });
      },
    );

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        locks: {
          request: mockRequest,
        },
      },
      configurable: true,
      writable: true,
    });

    const manager = new TabLockManager();
    await manager.acquire();

    manager.release();
    manager.release(); // Should not throw
    expect(manager.isHeld).toBe(false);
  });

  it('uses ifAvailable: true option to avoid blocking', async () => {
    const mockRequest = vi.fn(
      (
        _name: string,
        options: { ifAvailable: boolean },
        callback: (lock: unknown) => Promise<void>,
      ) => {
        expect(options.ifAvailable).toBe(true);
        void callback({ name: 'templeossy-instance', mode: 'exclusive' });
      },
    );

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        locks: {
          request: mockRequest,
        },
      },
      configurable: true,
      writable: true,
    });

    const manager = new TabLockManager();
    await manager.acquire();

    expect(mockRequest).toHaveBeenCalledWith(
      'templeossy-instance',
      { ifAvailable: true },
      expect.any(Function),
    );

    manager.release();
  });
});

// ─── TabLockResult type ────────────────────────────────────────────────────

describe('TabLockResult type', () => {
  it('acquired result has correct shape', () => {
    const result: TabLockResult = { acquired: true };
    expect(result.acquired).toBe(true);
  });

  it('held-by-other-tab result has correct shape', () => {
    const result: TabLockResult = { acquired: false, reason: 'held-by-other-tab' };
    expect(result.acquired).toBe(false);
    expect(result.reason).toBe('held-by-other-tab');
  });

  it('api-unavailable result has correct shape', () => {
    const result: TabLockResult = { acquired: false, reason: 'api-unavailable' };
    expect(result.acquired).toBe(false);
    expect(result.reason).toBe('api-unavailable');
  });
});
