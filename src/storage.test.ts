/**
 * @vitest-environment jsdom
 */

/**
 * storage.test.ts — Tests for browser storage abstraction layer.
 *
 * Tests cover:
 * - Storage backend detection (OPFS vs IndexedDB)
 * - DiskStorage save/load/delete operations (mocked)
 * - hasSavedDisk detection logic
 * - Boot medium selection
 * - Boot order flag generation
 * - AutoSaveManager lifecycle
 * - requestPersistence behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  detectStorageBackend,
  requestPersistence,
  isQuotaError,
  DiskStorage,
  selectBootMedium,
  getBootOrderFlag,
  AutoSaveManager,
  type StorageBackend,
  type BootMedium,
} from './storage';

// ─── Storage Backend Detection ─────────────────────────────────────────────

describe('detectStorageBackend', () => {
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    // Restore original navigator
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  it('returns "opfs" when navigator.storage.getDirectory is available', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        storage: {
          getDirectory: vi.fn(),
        },
      },
      configurable: true,
      writable: true,
    });

    expect(detectStorageBackend()).toBe('opfs');
  });

  it('returns "indexeddb" when navigator.storage.getDirectory is not available', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        storage: {},
      },
      configurable: true,
      writable: true,
    });

    expect(detectStorageBackend()).toBe('indexeddb');
  });

  it('returns "indexeddb" when navigator.storage is undefined', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
      writable: true,
    });

    expect(detectStorageBackend()).toBe('indexeddb');
  });

  it('returns "indexeddb" when navigator is undefined', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    expect(detectStorageBackend()).toBe('indexeddb');
  });
});

// ─── requestPersistence ────────────────────────────────────────────────────

describe('requestPersistence', () => {
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  it('returns true when persist() resolves to true', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        storage: {
          persist: vi.fn().mockResolvedValue(true),
        },
      },
      configurable: true,
      writable: true,
    });

    const result = await requestPersistence();
    expect(result).toBe(true);
  });

  it('returns false when persist() resolves to false', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        storage: {
          persist: vi.fn().mockResolvedValue(false),
        },
      },
      configurable: true,
      writable: true,
    });

    const result = await requestPersistence();
    expect(result).toBe(false);
  });

  it('returns false when persist() throws', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        storage: {
          persist: vi.fn().mockRejectedValue(new Error('denied')),
        },
      },
      configurable: true,
      writable: true,
    });

    const result = await requestPersistence();
    expect(result).toBe(false);
  });

  it('returns false when navigator.storage.persist is not available', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        storage: {},
      },
      configurable: true,
      writable: true,
    });

    const result = await requestPersistence();
    expect(result).toBe(false);
  });

  it('returns false when navigator is undefined', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const result = await requestPersistence();
    expect(result).toBe(false);
  });
});

// ─── DiskStorage ───────────────────────────────────────────────────────────

describe('DiskStorage', () => {
  it('uses specified backend', () => {
    const opfs = new DiskStorage('opfs');
    expect(opfs.backend).toBe('opfs');

    const idb = new DiskStorage('indexeddb');
    expect(idb.backend).toBe('indexeddb');
  });

  it('auto-detects backend when none specified', () => {
    const storage = new DiskStorage();
    // In Node.js test environment, OPFS is not available, so should be indexeddb
    expect(['opfs', 'indexeddb']).toContain(storage.backend);
  });

  it('createDisk returns empty Uint8Array', () => {
    const storage = new DiskStorage('indexeddb');
    const disk = storage.createDisk(2 * 1024 * 1024 * 1024);
    expect(disk).toBeInstanceOf(Uint8Array);
    expect(disk.length).toBe(0);
  });

  it('createDisk accepts various sizes', () => {
    const storage = new DiskStorage('indexeddb');

    const small = storage.createDisk(1024);
    expect(small).toBeInstanceOf(Uint8Array);

    const large = storage.createDisk(4 * 1024 * 1024 * 1024);
    expect(large).toBeInstanceOf(Uint8Array);
  });
});

// ─── DiskStorage operations (using mocked backend) ─────────────────────────

describe('DiskStorage operations (mocked)', () => {
  /**
   * Since jsdom does not provide IndexedDB or OPFS, we test DiskStorage
   * operations by mocking the internal methods. This validates the public
   * API contract and data flow.
   */

  it('hasSavedDisk returns false when no disk saved', async () => {
    const storage = new DiskStorage('indexeddb');
    // Mock internal - hasSavedDisk catches errors and returns false
    const result = await storage.hasSavedDisk();
    expect(result).toBe(false);
  });

  it('saveDisk and loadDisk round-trip data correctly (via mock)', async () => {
    const storage = new DiskStorage('indexeddb');
    const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    // Mock saveDisk and loadDisk
    let savedData: Uint8Array | null = null;
    storage.saveDisk = vi.fn(async (data: Uint8Array) => { savedData = data; });
    storage.loadDisk = vi.fn(async () => savedData);
    storage.hasSavedDisk = vi.fn(async () => savedData !== null);

    await storage.saveDisk(testData);
    expect(storage.saveDisk).toHaveBeenCalledWith(testData);

    const loaded = await storage.loadDisk();
    expect(loaded).not.toBeNull();
    expect(loaded!.length).toBe(testData.length);
    expect(Array.from(loaded!)).toEqual(Array.from(testData));
  });

  it('hasSavedDisk returns true after saving (via mock)', async () => {
    const storage = new DiskStorage('indexeddb');
    let saved = false;
    storage.saveDisk = vi.fn(async () => { saved = true; });
    storage.hasSavedDisk = vi.fn(async () => saved);

    await storage.saveDisk(new Uint8Array([10, 20, 30]));
    const result = await storage.hasSavedDisk();
    expect(result).toBe(true);
  });

  it('deleteDisk removes saved disk (via mock)', async () => {
    const storage = new DiskStorage('indexeddb');
    let saved = true;
    storage.hasSavedDisk = vi.fn(async () => saved);
    storage.deleteDisk = vi.fn(async () => { saved = false; });

    expect(await storage.hasSavedDisk()).toBe(true);
    await storage.deleteDisk();
    expect(await storage.hasSavedDisk()).toBe(false);
  });

  it('loadDisk returns null after delete (via mock)', async () => {
    const storage = new DiskStorage('indexeddb');
    let data: Uint8Array | null = new Uint8Array([10, 20, 30]);
    storage.loadDisk = vi.fn(async () => data);
    storage.deleteDisk = vi.fn(async () => { data = null; });

    await storage.deleteDisk();
    const loaded = await storage.loadDisk();
    expect(loaded).toBeNull();
  });

  it('deleteDisk is safe when no disk exists', async () => {
    const storage = new DiskStorage('indexeddb');
    storage.deleteDisk = vi.fn(async () => { /* no-op */ });
    storage.hasSavedDisk = vi.fn(async () => false);

    // Should not throw
    await storage.deleteDisk();
    expect(await storage.hasSavedDisk()).toBe(false);
  });

  it('saveDisk overwrites existing data (via mock)', async () => {
    const storage = new DiskStorage('indexeddb');
    let savedData: Uint8Array | null = null;
    storage.saveDisk = vi.fn(async (d: Uint8Array) => { savedData = d; });
    storage.loadDisk = vi.fn(async () => savedData);

    await storage.saveDisk(new Uint8Array([1, 2, 3]));
    await storage.saveDisk(new Uint8Array([4, 5, 6, 7]));

    const loaded = await storage.loadDisk();
    expect(loaded).not.toBeNull();
    expect(loaded!.length).toBe(4);
    expect(Array.from(loaded!)).toEqual([4, 5, 6, 7]);
  });

  it('handles empty data (via mock)', async () => {
    const storage = new DiskStorage('indexeddb');
    let savedData: Uint8Array | null = null;
    storage.saveDisk = vi.fn(async (d: Uint8Array) => { savedData = d; });
    storage.loadDisk = vi.fn(async () => savedData);

    await storage.saveDisk(new Uint8Array(0));
    const loaded = await storage.loadDisk();
    expect(loaded).not.toBeNull();
    expect(loaded!.length).toBe(0);
  });
});

// ─── Boot Medium Selection ─────────────────────────────────────────────────

describe('selectBootMedium', () => {
  it('returns "cd" for first visit (no saved disk)', () => {
    const result = selectBootMedium(false, null);
    expect(result).toBe('cd');
  });

  it('returns "cd" for first visit regardless of choice', () => {
    expect(selectBootMedium(false, 'resume')).toBe('cd');
    expect(selectBootMedium(false, 'fresh')).toBe('cd');
    expect(selectBootMedium(false, null)).toBe('cd');
  });

  it('returns "disk" when user chooses resume with saved disk', () => {
    const result = selectBootMedium(true, 'resume');
    expect(result).toBe('disk');
  });

  it('returns "cd" when user chooses fresh with saved disk', () => {
    const result = selectBootMedium(true, 'fresh');
    expect(result).toBe('cd');
  });

  it('returns "cd" when user makes no choice (null) with saved disk', () => {
    const result = selectBootMedium(true, null);
    expect(result).toBe('cd');
  });
});

describe('getBootOrderFlag', () => {
  it('returns "d" for CD boot', () => {
    expect(getBootOrderFlag('cd')).toBe('d');
  });

  it('returns "c" for disk boot', () => {
    expect(getBootOrderFlag('disk')).toBe('c');
  });

  it('returns correct flag for all BootMedium values', () => {
    const mediums: BootMedium[] = ['cd', 'disk'];
    const expected: Record<BootMedium, string> = {
      cd: 'd',
      disk: 'c',
    };
    for (const m of mediums) {
      expect(getBootOrderFlag(m)).toBe(expected[m]);
    }
  });
});

// ─── AutoSaveManager ──────────────────────────────────────────────────────

describe('AutoSaveManager', () => {
  let mockStorage: DiskStorage;
  let saveDiskSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockStorage = new DiskStorage('indexeddb');
    saveDiskSpy = vi.fn().mockResolvedValue(undefined);
    mockStorage.saveDisk = saveDiskSpy;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in non-running state', () => {
    const reader = vi.fn().mockReturnValue(new Uint8Array([1, 2, 3]));
    const manager = new AutoSaveManager(mockStorage, reader);
    expect(manager.isRunning).toBe(false);
  });

  it('transitions to running state on start()', () => {
    const reader = vi.fn().mockReturnValue(new Uint8Array([1, 2, 3]));
    const manager = new AutoSaveManager(mockStorage, reader);
    manager.start();
    expect(manager.isRunning).toBe(true);
  });

  it('periodic flush calls saveDisk every 30 seconds', async () => {
    const testData = new Uint8Array([1, 2, 3]);
    const reader = vi.fn().mockReturnValue(testData);
    const manager = new AutoSaveManager(mockStorage, reader);

    manager.start();

    // Advance past 30 seconds
    await vi.advanceTimersByTimeAsync(30_000);
    expect(saveDiskSpy).toHaveBeenCalledTimes(1);
    expect(saveDiskSpy).toHaveBeenCalledWith(testData);

    // Advance another 30 seconds
    await vi.advanceTimersByTimeAsync(30_000);
    expect(saveDiskSpy).toHaveBeenCalledTimes(2);

    await manager.stop();
  });

  it('does not save when reader returns null', async () => {
    const reader = vi.fn().mockReturnValue(null);
    const manager = new AutoSaveManager(mockStorage, reader);

    manager.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(saveDiskSpy).not.toHaveBeenCalled();

    await manager.stop();
  });

  it('does not save when reader returns empty array', async () => {
    const reader = vi.fn().mockReturnValue(new Uint8Array(0));
    const manager = new AutoSaveManager(mockStorage, reader);

    manager.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(saveDiskSpy).not.toHaveBeenCalled();

    await manager.stop();
  });

  it('stop() clears interval and performs final flush', async () => {
    const testData = new Uint8Array([4, 5, 6]);
    const reader = vi.fn().mockReturnValue(testData);
    const manager = new AutoSaveManager(mockStorage, reader);

    manager.start();
    await manager.stop();

    expect(manager.isRunning).toBe(false);
    // Final flush on stop
    expect(saveDiskSpy).toHaveBeenCalledTimes(1);
    expect(saveDiskSpy).toHaveBeenCalledWith(testData);

    // No more saves after stop
    await vi.advanceTimersByTimeAsync(60_000);
    expect(saveDiskSpy).toHaveBeenCalledTimes(1);
  });

  it('start() is idempotent — calling twice does not create duplicate intervals', async () => {
    const testData = new Uint8Array([7, 8, 9]);
    const reader = vi.fn().mockReturnValue(testData);
    const manager = new AutoSaveManager(mockStorage, reader);

    manager.start();
    manager.start(); // Should be no-op

    await vi.advanceTimersByTimeAsync(30_000);
    // Should only have saved once (one interval, not two)
    expect(saveDiskSpy).toHaveBeenCalledTimes(1);

    await manager.stop();
  });

  it('flush() can be called manually', async () => {
    const testData = new Uint8Array([10, 11, 12]);
    const reader = vi.fn().mockReturnValue(testData);
    const manager = new AutoSaveManager(mockStorage, reader);

    await manager.flush();
    expect(saveDiskSpy).toHaveBeenCalledTimes(1);
    expect(saveDiskSpy).toHaveBeenCalledWith(testData);
  });

  it('handles saveDisk errors gracefully during periodic flush', async () => {
    const testData = new Uint8Array([1, 2, 3]);
    const reader = vi.fn().mockReturnValue(testData);
    saveDiskSpy.mockRejectedValue(new Error('Storage full'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const manager = new AutoSaveManager(mockStorage, reader);
    manager.start();

    await vi.advanceTimersByTimeAsync(30_000);
    // Should not throw — error handled gracefully
    expect(warnSpy).toHaveBeenCalled();

    await manager.stop();
    warnSpy.mockRestore();
  });

  it('registers beforeunload handler on start', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const reader = vi.fn().mockReturnValue(new Uint8Array([1]));
    const manager = new AutoSaveManager(mockStorage, reader);

    manager.start();
    expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));

    void manager.stop();
    addSpy.mockRestore();
  });

  it('removes beforeunload handler on stop', async () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const reader = vi.fn().mockReturnValue(new Uint8Array([1]));
    const manager = new AutoSaveManager(mockStorage, reader);

    manager.start();
    await manager.stop();
    expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));

    removeSpy.mockRestore();
  });
});

// ─── Resume Detection Logic ───────────────────────────────────────────────

describe('Resume detection logic', () => {
  it('first visit workflow: no disk → boot from CD', () => {
    const hasDisk = false;
    const medium = selectBootMedium(hasDisk, null);
    expect(medium).toBe('cd');
    expect(getBootOrderFlag(medium)).toBe('d');
  });

  it('return visit + resume workflow: has disk → boot from disk', () => {
    const hasDisk = true;
    const medium = selectBootMedium(hasDisk, 'resume');
    expect(medium).toBe('disk');
    expect(getBootOrderFlag(medium)).toBe('c');
  });

  it('return visit + fresh workflow: has disk → boot from CD, disk preserved', () => {
    const hasDisk = true;
    const medium = selectBootMedium(hasDisk, 'fresh');
    expect(medium).toBe('cd');
    expect(getBootOrderFlag(medium)).toBe('d');
    // Note: disk is still attached to QEMU — just boot order changes
  });
});

// ─── isQuotaError ──────────────────────────────────────────────────────────

describe('isQuotaError', () => {
  it('returns true for DOMException with name QuotaExceededError', () => {
    const err = new DOMException('Quota exceeded', 'QuotaExceededError');
    expect(isQuotaError(err)).toBe(true);
  });

  it('returns true for Error with "quota" in message (code 22 case)', () => {
    // DOMException code 22 is QuotaExceededError in some browsers;
    // in jsdom the code property is read-only, so we test the message pattern instead
    const err = new Error('Quota exceeded (code 22)');
    expect(isQuotaError(err)).toBe(true);
  });

  it('returns true for Error with "quota" in message', () => {
    const err = new Error('Quota has been exceeded');
    expect(isQuotaError(err)).toBe(true);
  });

  it('returns true for Error with "storage full" in message', () => {
    const err = new Error('The storage is full');
    expect(isQuotaError(err)).toBe(true);
  });

  it('returns false for regular Error', () => {
    const err = new Error('Something went wrong');
    expect(isQuotaError(err)).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isQuotaError('string error')).toBe(false);
    expect(isQuotaError(42)).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError(undefined)).toBe(false);
  });

  it('returns false for other DOMException types', () => {
    const err = new DOMException('Not found', 'NotFoundError');
    expect(isQuotaError(err)).toBe(false);
  });
});

// ─── AutoSaveManager storage error handling ────────────────────────────────

describe('AutoSaveManager storage error handling', () => {
  let mockStorage: DiskStorage;
  let saveDiskSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockStorage = new DiskStorage('indexeddb');
    saveDiskSpy = vi.fn().mockResolvedValue(undefined);
    mockStorage.saveDisk = saveDiskSpy;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onStorageError with quota type when quota error occurs', async () => {
    const testData = new Uint8Array([1, 2, 3]);
    const reader = vi.fn().mockReturnValue(testData);
    saveDiskSpy.mockRejectedValue(new DOMException('Quota exceeded', 'QuotaExceededError'));

    const errorHandler = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const manager = new AutoSaveManager(mockStorage, reader);
    manager.onStorageError = errorHandler;
    manager.start();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(errorHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'quota',
        message: expect.stringContaining('Storage full'),
      }),
    );

    await manager.stop();
  });

  it('reports quota error only once (no spamming)', async () => {
    const testData = new Uint8Array([1, 2, 3]);
    const reader = vi.fn().mockReturnValue(testData);
    saveDiskSpy.mockRejectedValue(new DOMException('Quota exceeded', 'QuotaExceededError'));

    const errorHandler = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const manager = new AutoSaveManager(mockStorage, reader);
    manager.onStorageError = errorHandler;
    manager.start();

    // Trigger multiple flush cycles
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);

    // Should only report once
    expect(errorHandler).toHaveBeenCalledTimes(1);

    await manager.stop();
  });

  it('calls onStorageError with write-error for non-quota errors', async () => {
    const testData = new Uint8Array([1, 2, 3]);
    const reader = vi.fn().mockReturnValue(testData);
    saveDiskSpy.mockRejectedValue(new Error('Disk I/O failure'));

    const errorHandler = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const manager = new AutoSaveManager(mockStorage, reader);
    manager.onStorageError = errorHandler;
    manager.start();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(errorHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'write-error',
        message: expect.stringContaining('Disk I/O failure'),
      }),
    );

    await manager.stop();
  });

  it('does not call onStorageError when no handler is set', async () => {
    const testData = new Uint8Array([1, 2, 3]);
    const reader = vi.fn().mockReturnValue(testData);
    saveDiskSpy.mockRejectedValue(new Error('Some error'));

    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const manager = new AutoSaveManager(mockStorage, reader);
    // Don't set onStorageError
    manager.start();

    // Should not throw
    await vi.advanceTimersByTimeAsync(30_000);

    await manager.stop();
  });
});

// ─── CD-only session safety ────────────────────────────────────────────────

describe('CD-only session safety', () => {
  it('fresh boot from CD with existing disk: user chooses "fresh" → boot from CD', () => {
    // The key behavior: user has a saved disk, chooses "fresh" (CD boot),
    // but the saved disk should NOT be corrupted
    const hasDisk = true;
    const medium = selectBootMedium(hasDisk, 'fresh');
    expect(medium).toBe('cd');
    // When medium is 'cd' AND hasDisk is true, auto-save should be disabled
    // (enforced in main.ts via shouldAutoSave logic)
  });

  it('first visit (no saved disk): boot from CD → auto-save should be active', () => {
    // First visit: no existing disk, so auto-save is needed for install
    const hasDisk = false;
    const medium = selectBootMedium(hasDisk, null);
    expect(medium).toBe('cd');
    // shouldAutoSave = !savedDiskData (null) → true
  });

  it('return visit + resume: boot from disk → auto-save should be active', () => {
    const hasDisk = true;
    const medium = selectBootMedium(hasDisk, 'resume');
    expect(medium).toBe('disk');
    // shouldAutoSave = (medium === 'disk') → true
  });

  it('CD-only session does not produce a "disk" boot medium', () => {
    // No matter the scenario, choosing fresh always gives CD boot
    expect(selectBootMedium(true, 'fresh')).toBe('cd');
    expect(selectBootMedium(false, 'fresh')).toBe('cd');
    expect(selectBootMedium(false, null)).toBe('cd');
  });
});

// ─── Wipe & Reset operation ───────────────────────────────────────────────

describe('Wipe & Reset operation', () => {
  let mockStorage: DiskStorage;

  beforeEach(() => {
    mockStorage = new DiskStorage('indexeddb');
  });

  it('wipe clears storage (via mock)', async () => {
    let hasDisk = true;
    let diskData: Uint8Array | null = new Uint8Array([1, 2, 3, 4, 5]);
    mockStorage.hasSavedDisk = vi.fn(async () => hasDisk);
    mockStorage.loadDisk = vi.fn(async () => diskData);
    mockStorage.deleteDisk = vi.fn(async () => {
      hasDisk = false;
      diskData = null;
    });

    // Verify disk exists before wipe
    expect(await mockStorage.hasSavedDisk()).toBe(true);
    expect(await mockStorage.loadDisk()).not.toBeNull();

    // Perform wipe
    await mockStorage.deleteDisk();

    // After wipe: no saved disk, behaves like first visit
    expect(await mockStorage.hasSavedDisk()).toBe(false);
    expect(await mockStorage.loadDisk()).toBeNull();
  });

  it('after wipe, boot medium is CD (first visit behavior)', async () => {
    let hasDisk = true;
    mockStorage.hasSavedDisk = vi.fn(async () => hasDisk);
    mockStorage.deleteDisk = vi.fn(async () => { hasDisk = false; });

    await mockStorage.deleteDisk();

    // Simulate next visit
    const hasNewDisk = await mockStorage.hasSavedDisk();
    const medium = selectBootMedium(hasNewDisk, null);

    expect(hasNewDisk).toBe(false);
    expect(medium).toBe('cd');
    expect(getBootOrderFlag(medium)).toBe('d');
  });

  it('wipe stops auto-save before deleting (prevents race)', async () => {
    vi.useFakeTimers();

    const saveDiskSpy = vi.fn().mockResolvedValue(undefined);
    mockStorage.saveDisk = saveDiskSpy;
    mockStorage.deleteDisk = vi.fn().mockResolvedValue(undefined);

    const reader = vi.fn().mockReturnValue(new Uint8Array([1, 2, 3]));
    const manager = new AutoSaveManager(mockStorage, reader);

    manager.start();
    expect(manager.isRunning).toBe(true);

    // Stop auto-save (simulating what wipeAndReset does)
    await manager.stop();
    expect(manager.isRunning).toBe(false);

    // Now delete disk
    await mockStorage.deleteDisk();
    expect(mockStorage.deleteDisk).toHaveBeenCalled();

    // No more saves after stop
    await vi.advanceTimersByTimeAsync(60_000);
    // saveDiskSpy was called once during stop()'s final flush
    expect(saveDiskSpy).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});

// ─── StorageBackend type ───────────────────────────────────────────────────

describe('StorageBackend type', () => {
  it('only allows valid backend values', () => {
    const backends: StorageBackend[] = ['opfs', 'indexeddb'];
    expect(backends).toHaveLength(2);
    expect(backends).toContain('opfs');
    expect(backends).toContain('indexeddb');
  });
});
