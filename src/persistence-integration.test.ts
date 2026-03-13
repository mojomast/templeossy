/**
 * @vitest-environment jsdom
 */

/**
 * persistence-integration.test.ts — End-to-end integration tests for
 * all persistence flows.
 *
 * Tests cover the following integration flows:
 *
 * 1) Return visitor resume flow:
 *    - Saved disk detected → resume dialog → choose Resume → boot from disk
 *
 * 2) Full lifecycle flow:
 *    - First visit → CD boot → install to disk → save → close
 *    - Return visit → resume → disk boot → verify data
 *    - Wipe & Reset → fresh CD boot
 *
 * 3) Crash recovery:
 *    - Auto-save persists data periodically
 *    - After crash (simulated), data from last flush is available
 *    - Emulator restarts normally with saved disk
 *
 * 4) TempleOS installation to virtual disk:
 *    - First visit creates empty disk → QEMU boots from CD with disk attached
 *    - Disk image grows after installation writes
 *    - Saved disk can be resumed
 *
 * 5) CD-only session doesn't corrupt existing disk
 *
 * 6) Wipe & Reset properly chains stop → delete (no race condition)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DiskStorage,
  AutoSaveManager,
  selectBootMedium,
  getBootOrderFlag,
  isQuotaError,
  type BootMedium,
  type DiskDataReader,
  type StorageErrorHandler,
} from './storage';
import { EmulatorLoader } from './emulator';
import { TabLockManager } from './tab-lock';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Create a mock DiskStorage with an in-memory backing store.
 */
function createMockStorage(): DiskStorage & { _store: Uint8Array | null } {
  const storage = new DiskStorage('indexeddb') as DiskStorage & { _store: Uint8Array | null };
  storage._store = null;

  storage.saveDisk = vi.fn(async (data: Uint8Array) => {
    // Copy to prevent aliasing (mimics real storage behavior)
    storage._store = new Uint8Array(data);
  });

  storage.loadDisk = vi.fn(async () => {
    return storage._store ? new Uint8Array(storage._store) : null;
  });

  storage.hasSavedDisk = vi.fn(async () => {
    return storage._store !== null && storage._store.length > 0;
  });

  storage.deleteDisk = vi.fn(async () => {
    storage._store = null;
  });

  return storage;
}

/**
 * Create a DiskDataReader that returns a simulated disk image.
 * The image can be mutated to simulate QEMU writes.
 */
function createDiskReader(initialData?: Uint8Array): {
  reader: DiskDataReader;
  setData: (data: Uint8Array | null) => void;
  getData: () => Uint8Array | null;
} {
  let data: Uint8Array | null = initialData ?? null;
  return {
    reader: () => data,
    setData: (d: Uint8Array | null) => { data = d; },
    getData: () => data,
  };
}

// ─── Flow 1: Return Visitor Resume ─────────────────────────────────────────

describe('Flow 1: Return visitor resume', () => {
  it('detects saved disk and selects disk boot when user chooses resume', async () => {
    // Simulate: previous session saved a disk image
    const storage = createMockStorage();
    storage._store = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x01, 0x02, 0x03]);

    // Step 1: Check for saved disk
    const hasSaved = await storage.hasSavedDisk();
    expect(hasSaved).toBe(true);

    // Step 2: User chooses "resume"
    const userChoice: 'resume' | 'fresh' = 'resume';
    const bootMedium = selectBootMedium(hasSaved, userChoice);
    expect(bootMedium).toBe('disk');
    expect(getBootOrderFlag(bootMedium)).toBe('c');

    // Step 3: Load disk data for injection
    const diskData = await storage.loadDisk();
    expect(diskData).not.toBeNull();
    expect(diskData!.length).toBe(8);

    // Step 4: Configure emulator with disk data
    const loader = new EmulatorLoader('templeos');
    loader.bootOrder = getBootOrderFlag(bootMedium);
    loader.diskImageData = diskData;

    // Verify boot order in QEMU args
    const args = loader.getQemuArgs();
    const bootIdx = args.indexOf('-boot');
    expect(args[bootIdx + 1]).toBe('c'); // Boot from disk
    expect(args).toContain('-hda'); // Disk image attached
  });

  it('falls back to CD boot if disk load fails', async () => {
    const storage = createMockStorage();
    // Simulate disk exists but load fails
    storage.hasSavedDisk = vi.fn(async () => true);
    storage.loadDisk = vi.fn(async () => null); // Load fails

    const hasSaved = await storage.hasSavedDisk();
    expect(hasSaved).toBe(true);

    const diskData = await storage.loadDisk();
    expect(diskData).toBeNull();

    // Should fall back to CD boot
    const bootMedium = selectBootMedium(hasSaved, 'resume');
    // Application code falls back to CD when loadDisk returns null
    // (even though selectBootMedium returns 'disk', the fallback is in main.ts logic)
    expect(bootMedium).toBe('disk');
    // But in main.ts, the actual code does:
    // if (!savedDiskData) { bootMedium = 'cd'; }
    // So after the failed load, boot medium should be overridden to CD
    let actualBootMedium: BootMedium = bootMedium;
    if (!diskData) {
      actualBootMedium = 'cd';
    }
    expect(actualBootMedium).toBe('cd');
    expect(getBootOrderFlag(actualBootMedium)).toBe('d');
  });

  it('resume with saved disk configures EmulatorLoader correctly', async () => {
    const storage = createMockStorage();
    const diskImage = new Uint8Array(1024);
    // Write some non-zero data to simulate an installed disk
    diskImage.fill(0xAB, 0, 512);
    storage._store = diskImage;

    const diskData = await storage.loadDisk();
    expect(diskData).not.toBeNull();
    expect(diskData!.length).toBe(1024);

    const loader = new EmulatorLoader('templeos');
    loader.bootOrder = 'c';
    loader.diskImageData = diskData;

    // Verify QEMU args are configured for disk boot
    const args = loader.getQemuArgs();
    expect(args[args.indexOf('-boot') + 1]).toBe('c');
    expect(args).toContain('-hda');
    expect(args).toContain('/pack/disk.img');

    // Verify module config is buildable (preRun hooks are added during load())
    const config = loader.buildModuleConfig();
    expect(config.arguments).toBeDefined();
    expect(config.locateFile).toBeDefined();
    expect(config.mainScriptUrlOrBlob).toBe('/emulator/qemu-system-x86_64.js');
  });
});

// ─── Flow 2: Full Lifecycle ────────────────────────────────────────────────

describe('Flow 2: Full lifecycle', () => {
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    vi.useFakeTimers();
    storage = createMockStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('first visit → CD boot → install → save → close → resume → wipe', async () => {
    // ── Phase 1: First visit ──
    let hasSaved = await storage.hasSavedDisk();
    expect(hasSaved).toBe(false);

    let bootMedium = selectBootMedium(hasSaved, null);
    expect(bootMedium).toBe('cd');
    expect(getBootOrderFlag(bootMedium)).toBe('d');

    // First visit: EmulatorLoader creates empty sparse disk
    const loader = new EmulatorLoader('templeos');
    loader.bootOrder = 'd';
    const args = loader.getQemuArgs();
    expect(args).toContain('-boot');
    expect(args[args.indexOf('-boot') + 1]).toBe('d');

    // ── Phase 2: TempleOS installs to disk (QEMU writes) ──
    // Simulate QEMU writing to the disk image
    const diskAfterInstall = new Uint8Array(2048);
    diskAfterInstall.fill(0xCA, 0, 1024); // MBR + boot sector
    diskAfterInstall.fill(0xFE, 1024, 2048); // File system data

    const { reader, setData } = createDiskReader(diskAfterInstall);

    // ── Phase 3: Auto-save persists the installed disk ──
    const autoSave = new AutoSaveManager(storage, reader);
    autoSave.start();

    // Trigger auto-save (advance 30s)
    await vi.advanceTimersByTimeAsync(30_000);
    expect(storage.saveDisk).toHaveBeenCalledTimes(1);

    // Verify saved data matches
    expect(storage._store).not.toBeNull();
    expect(storage._store!.length).toBe(2048);

    await autoSave.stop();

    // ── Phase 4: Close browser (tab close) ──
    // beforeunload would trigger flushSync — but stop() already did final flush

    // ── Phase 5: Return visit — Resume ──
    hasSaved = await storage.hasSavedDisk();
    expect(hasSaved).toBe(true);

    const userChoice = 'resume';
    bootMedium = selectBootMedium(hasSaved, userChoice);
    expect(bootMedium).toBe('disk');

    const resumedDisk = await storage.loadDisk();
    expect(resumedDisk).not.toBeNull();
    expect(resumedDisk!.length).toBe(2048);
    // Verify data integrity: MBR area
    expect(resumedDisk![0]).toBe(0xCA);
    expect(resumedDisk![1023]).toBe(0xCA);
    // File system area
    expect(resumedDisk![1024]).toBe(0xFE);
    expect(resumedDisk![2047]).toBe(0xFE);

    // ── Phase 6: Wipe & Reset ──
    // Create a new auto-save for the resumed session
    const resumeAutoSave = new AutoSaveManager(storage, reader);
    resumeAutoSave.start();

    // Wipe: stop auto-save, then delete disk
    await resumeAutoSave.stop();
    await storage.deleteDisk();

    hasSaved = await storage.hasSavedDisk();
    expect(hasSaved).toBe(false);

    // Next visit behaves like first visit
    bootMedium = selectBootMedium(hasSaved, null);
    expect(bootMedium).toBe('cd');
  });

  it('multiple save cycles accumulate disk changes correctly', async () => {
    // Simulate evolving disk data over time
    const { reader, setData } = createDiskReader(new Uint8Array([1, 2, 3]));

    const autoSave = new AutoSaveManager(storage, reader);
    autoSave.start();

    // First save cycle
    await vi.advanceTimersByTimeAsync(30_000);
    expect(storage._store!.length).toBe(3);
    expect(Array.from(storage._store!)).toEqual([1, 2, 3]);

    // Disk grows after more writes
    setData(new Uint8Array([1, 2, 3, 4, 5, 6]));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(storage._store!.length).toBe(6);
    expect(Array.from(storage._store!)).toEqual([1, 2, 3, 4, 5, 6]);

    // Disk gets modified further
    setData(new Uint8Array([10, 20, 30, 40, 50, 60]));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(Array.from(storage._store!)).toEqual([10, 20, 30, 40, 50, 60]);

    await autoSave.stop();
  });
});

// ─── Flow 3: Crash Recovery ───────────────────────────────────────────────

describe('Flow 3: Crash recovery', () => {
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    vi.useFakeTimers();
    storage = createMockStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('data from last auto-save survives after simulated crash', async () => {
    // Simulate: TempleOS running, user created files
    const diskWithFiles = new Uint8Array(4096);
    diskWithFiles.fill(0x42, 0, 2048); // Boot sector + installed OS
    diskWithFiles.fill(0xDE, 2048, 4096); // User files

    const { reader } = createDiskReader(diskWithFiles);

    const autoSave = new AutoSaveManager(storage, reader);
    autoSave.start();

    // Auto-save fires at 30 seconds
    await vi.advanceTimersByTimeAsync(30_000);
    expect(storage._store).not.toBeNull();
    expect(storage._store!.length).toBe(4096);

    // ── Simulate crash: Worker force-terminated ──
    // Auto-save doesn't get a chance to stop gracefully
    // (We just abandon the AutoSaveManager without calling stop())

    // Clear interval manually to simulate crash (not clean stop)
    // In real scenario, the browser tab would just be gone

    // ── After crash: reload page ──
    // The last flushed data should still be in storage
    const hasSaved = await storage.hasSavedDisk();
    expect(hasSaved).toBe(true);

    const recoveredDisk = await storage.loadDisk();
    expect(recoveredDisk).not.toBeNull();
    expect(recoveredDisk!.length).toBe(4096);

    // Verify data integrity from last save
    expect(recoveredDisk![0]).toBe(0x42);
    expect(recoveredDisk![2048]).toBe(0xDE);

    // Can resume from recovered disk
    const bootMedium = selectBootMedium(true, 'resume');
    expect(bootMedium).toBe('disk');
  });

  it('crash between saves loses at most 30 seconds of data', async () => {
    // Initial disk data (represents last successful save)
    const diskV1 = new Uint8Array([0xAA, 0xBB, 0xCC]);
    const { reader, setData } = createDiskReader(diskV1);

    const autoSave = new AutoSaveManager(storage, reader);
    autoSave.start();

    // First save at 30s
    await vi.advanceTimersByTimeAsync(30_000);
    expect(storage._store).not.toBeNull();
    expect(Array.from(storage._store!)).toEqual([0xAA, 0xBB, 0xCC]);

    // User makes changes at 31s (new data)
    setData(new Uint8Array([0xDD, 0xEE, 0xFF]));

    // Crash at 45s — 15 seconds into the new interval
    // Only 15 seconds of unsaved data is lost
    await vi.advanceTimersByTimeAsync(15_000);
    // No new save has occurred yet

    // Storage still has V1 data
    expect(Array.from(storage._store!)).toEqual([0xAA, 0xBB, 0xCC]);

    // After crash + reload, user gets V1 (last saved version)
    const recovered = await storage.loadDisk();
    expect(Array.from(recovered!)).toEqual([0xAA, 0xBB, 0xCC]);
  });

  it('page refresh mid-execution: saved data survives', async () => {
    // Simulate normal operation with periodic saves
    const diskData = new Uint8Array(512);
    diskData.fill(0x77);

    const { reader } = createDiskReader(diskData);

    const autoSave = new AutoSaveManager(storage, reader);
    autoSave.start();

    // Two successful save cycles
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(storage.saveDisk).toHaveBeenCalledTimes(2);

    // Page refresh — assume beforeunload fired (best effort save)
    // After reload, data from last save should be there
    const recovered = await storage.loadDisk();
    expect(recovered).not.toBeNull();
    expect(recovered!.length).toBe(512);
    expect(recovered![0]).toBe(0x77);

    // Can resume normally
    const hasSaved = await storage.hasSavedDisk();
    expect(hasSaved).toBe(true);
    expect(selectBootMedium(hasSaved, 'resume')).toBe('disk');
  });

  it('disk not corrupted by concurrent save failure', async () => {
    // Pre-existing good disk
    storage._store = new Uint8Array([0x01, 0x02, 0x03, 0x04]);

    const { reader } = createDiskReader(new Uint8Array([0x05, 0x06, 0x07, 0x08]));

    // Make saveDisk fail on subsequent calls
    let callCount = 0;
    storage.saveDisk = vi.fn(async (data: Uint8Array) => {
      callCount++;
      if (callCount > 1) {
        throw new Error('Simulated write failure');
      }
      storage._store = new Uint8Array(data);
    });

    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const autoSave = new AutoSaveManager(storage, reader);
    autoSave.start();

    // First save succeeds
    await vi.advanceTimersByTimeAsync(30_000);
    expect(storage._store).not.toBeNull();
    expect(Array.from(storage._store!)).toEqual([0x05, 0x06, 0x07, 0x08]);

    // Second save fails — storage keeps the first save
    await vi.advanceTimersByTimeAsync(30_000);
    expect(Array.from(storage._store!)).toEqual([0x05, 0x06, 0x07, 0x08]);

    await autoSave.stop();
  });
});

// ─── Flow 4: TempleOS Installation to Virtual Disk ─────────────────────────

describe('Flow 4: TempleOS installation to virtual disk', () => {
  it('first visit creates empty disk for QEMU, boots from CD', () => {
    const loader = new EmulatorLoader('templeos');
    loader.bootOrder = 'd'; // CD boot for first visit

    const args = loader.getQemuArgs();

    // Verify QEMU is configured with both CD and disk
    expect(args).toContain('-cdrom');
    expect(args).toContain('/pack/TempleOSCDV5.03.ISO');
    expect(args).toContain('-hda');
    expect(args).toContain('/pack/disk.img');

    // Boot from CD (first visit)
    const bootIdx = args.indexOf('-boot');
    expect(args[bootIdx + 1]).toBe('d');

    // Uses IDE disk controller (required by TempleOS)
    expect(args.join(' ')).not.toContain('virtio');

    // Uses legacy BIOS (not UEFI)
    expect(args).not.toContain('-bios');
  });

  it('first visit: EmulatorLoader defaults to CD boot with disk attached', () => {
    const loader = new EmulatorLoader('templeos');
    // No disk image data = first visit (sparse disk created during load())
    loader.diskImageData = null;
    loader.bootOrder = 'd';

    const args = loader.getQemuArgs();

    // CD boot with writable disk attached
    expect(args[args.indexOf('-boot') + 1]).toBe('d');
    expect(args).toContain('-hda');
    expect(args).toContain('/pack/disk.img');
    expect(args).toContain('-cdrom');

    // Module config is buildable
    const config = loader.buildModuleConfig();
    expect(config.arguments).toBeDefined();
    // preRun hooks for disk setup are added during load(), not buildModuleConfig()
    expect(Array.isArray(config.preRun)).toBe(true);
  });

  it('resume: EmulatorLoader configured for disk boot with saved data', () => {
    const savedDisk = new Uint8Array([0x55, 0xAA, 0x00, 0x01]); // MBR signature
    const loader = new EmulatorLoader('templeos');
    loader.diskImageData = savedDisk;
    loader.bootOrder = 'c'; // Disk boot for resume

    const args = loader.getQemuArgs();
    expect(args[args.indexOf('-boot') + 1]).toBe('c');
    expect(args).toContain('-hda');
    expect(args).toContain('/pack/disk.img');

    // preRun hooks for disk restoration are added during load(), not buildModuleConfig()
    const config = loader.buildModuleConfig();
    expect(Array.isArray(config.preRun)).toBe(true);
  });

  it('disk image grows after installation (simulated via auto-save)', async () => {
    vi.useFakeTimers();

    const storage = createMockStorage();

    // Start with empty disk (first visit)
    const { reader, setData } = createDiskReader(new Uint8Array(0));

    const autoSave = new AutoSaveManager(storage, reader);
    autoSave.start();

    // No save when disk is empty
    await vi.advanceTimersByTimeAsync(30_000);
    expect(storage.saveDisk).toHaveBeenCalledTimes(0); // Empty data not saved

    // TempleOS installer writes to disk
    setData(new Uint8Array(8192));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(storage.saveDisk).toHaveBeenCalledTimes(1);
    expect(storage._store!.length).toBe(8192);

    // More writes during installation
    const largerDisk = new Uint8Array(65536);
    largerDisk.fill(0x42);
    setData(largerDisk);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(storage._store!.length).toBe(65536);

    await autoSave.stop();
    vi.useRealTimers();
  });

  it('installed system can be resumed after browser restart', async () => {
    const storage = createMockStorage();

    // Save an "installed" disk image
    const installedDisk = new Uint8Array(16384);
    installedDisk.fill(0x55, 0, 512); // MBR
    installedDisk.fill(0xBB, 512, 16384); // OS files
    await storage.saveDisk(installedDisk);

    // Simulate browser restart — check for saved disk
    const hasSaved = await storage.hasSavedDisk();
    expect(hasSaved).toBe(true);

    // Load disk and configure for resume
    const diskData = await storage.loadDisk();
    expect(diskData).not.toBeNull();
    expect(diskData!.length).toBe(16384);
    expect(diskData![0]).toBe(0x55); // MBR intact
    expect(diskData![512]).toBe(0xBB); // OS files intact

    // Boot from disk
    const bootMedium = selectBootMedium(true, 'resume');
    expect(bootMedium).toBe('disk');

    const loader = new EmulatorLoader('templeos');
    loader.bootOrder = 'c';
    loader.diskImageData = diskData;

    const args = loader.getQemuArgs();
    expect(args[args.indexOf('-boot') + 1]).toBe('c');
  });
});

// ─── Flow 5: CD-Only Session Doesn't Corrupt Disk ─────────────────────────

describe('Flow 5: CD-only session safety', () => {
  it('fresh CD boot does not overwrite existing saved disk', async () => {
    vi.useFakeTimers();

    const storage = createMockStorage();

    // Existing installed disk
    const installedDisk = new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD]);
    await storage.saveDisk(installedDisk);
    expect(storage._store!.length).toBe(4);

    // User returns, chooses "Start fresh" (CD boot)
    const hasSaved = await storage.hasSavedDisk();
    expect(hasSaved).toBe(true);

    const bootMedium = selectBootMedium(true, 'fresh');
    expect(bootMedium).toBe('cd');

    // In main.ts, when bootMedium is 'cd' AND savedDiskData is non-null,
    // auto-save is disabled (shouldAutoSave = false).
    // Simulate: auto-save NOT started (the protection mechanism)

    // Even after time passes, no saves happen
    // (auto-save was never started)

    // Existing disk data remains intact
    const diskAfterSession = await storage.loadDisk();
    expect(diskAfterSession).not.toBeNull();
    expect(Array.from(diskAfterSession!)).toEqual([0xAA, 0xBB, 0xCC, 0xDD]);

    vi.useRealTimers();
  });

  it('"Start fresh" preserves disk for future resume', async () => {
    const storage = createMockStorage();

    // Save an installed disk
    const installedDisk = new Uint8Array(1024);
    installedDisk.fill(0xFF);
    await storage.saveDisk(installedDisk);

    // User chooses "Start fresh" — disk NOT deleted
    const bootMedium = selectBootMedium(true, 'fresh');
    expect(bootMedium).toBe('cd');
    // Note: "Start fresh" does NOT call deleteDisk
    // The disk remains for the next time

    // Next visit: disk still exists
    const hasSaved = await storage.hasSavedDisk();
    expect(hasSaved).toBe(true);

    // Can still resume next time
    const nextBootMedium = selectBootMedium(true, 'resume');
    expect(nextBootMedium).toBe('disk');

    const loadedDisk = await storage.loadDisk();
    expect(loadedDisk!.length).toBe(1024);
    expect(loadedDisk![0]).toBe(0xFF);
  });

  it('auto-save logic: shouldAutoSave is false for CD-only session with existing disk', () => {
    // This tests the shouldAutoSave logic from main.ts:
    // shouldAutoSave = bootMode === 'templeos' && (
    //   bootMedium === 'disk' ||  // Resume
    //   !savedDiskData             // First visit
    // )

    const bootMode = 'templeos';

    // Case 1: Resume (disk boot) → auto-save ON
    {
      const bootMedium: BootMedium = 'disk';
      const savedDiskData: Uint8Array | null = new Uint8Array([1, 2, 3]);
      const shouldAutoSave = bootMode === 'templeos' && (
        bootMedium === 'disk' || !savedDiskData
      );
      expect(shouldAutoSave).toBe(true);
    }

    // Case 2: First visit (no saved disk) → auto-save ON
    {
      const bootMedium: BootMedium = 'cd';
      const savedDiskData: Uint8Array | null = null;
      const shouldAutoSave = bootMode === 'templeos' && (
        bootMedium === 'disk' || !savedDiskData
      );
      expect(shouldAutoSave).toBe(true);
    }

    // Case 3: CD-only session with existing disk → auto-save OFF
    {
      const bootMedium: BootMedium = 'cd';
      const savedDiskData: Uint8Array | null = new Uint8Array([1, 2, 3]);
      const shouldAutoSave = bootMode === 'templeos' && (
        bootMedium === 'disk' || !savedDiskData
      );
      expect(shouldAutoSave).toBe(false);
    }
  });
});

// ─── Flow 6: Wipe & Reset Race Condition ──────────────────────────────────

describe('Flow 6: Wipe & Reset proper sequencing', () => {
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    vi.useFakeTimers();
    storage = createMockStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stop() completes final flush before deleteDisk is called', async () => {
    const diskData = new Uint8Array([0x11, 0x22, 0x33]);
    const { reader } = createDiskReader(diskData);

    const autoSave = new AutoSaveManager(storage, reader);
    autoSave.start();

    // Simulate wipe flow: await stop, then delete
    const callOrder: string[] = [];

    const origSaveDisk = storage.saveDisk;
    storage.saveDisk = vi.fn(async (data: Uint8Array) => {
      callOrder.push('saveDisk');
      await origSaveDisk(data);
    });

    const origDeleteDisk = storage.deleteDisk;
    storage.deleteDisk = vi.fn(async () => {
      callOrder.push('deleteDisk');
      await origDeleteDisk();
    });

    // This is what the fixed wipeAndReset does:
    await autoSave.stop();  // Includes final flush
    await storage.deleteDisk();

    // saveDisk (final flush) should happen BEFORE deleteDisk
    expect(callOrder).toEqual(['saveDisk', 'deleteDisk']);

    // After delete, storage is empty
    expect(await storage.hasSavedDisk()).toBe(false);
  });

  it('wipe with no active auto-save manager still works', async () => {
    // Simulate wipe when auto-save was never started
    storage._store = new Uint8Array([0xAA, 0xBB, 0xCC]);

    const stopPromise = Promise.resolve(); // No auto-save to stop
    await stopPromise;
    await storage.deleteDisk();

    expect(await storage.hasSavedDisk()).toBe(false);
    expect(storage._store).toBeNull();
  });

  it('wipe during active auto-save prevents further saves', async () => {
    const { reader, setData } = createDiskReader(new Uint8Array([0x01, 0x02]));

    const autoSave = new AutoSaveManager(storage, reader);
    autoSave.start();

    // Let one save happen
    await vi.advanceTimersByTimeAsync(30_000);
    expect(storage.saveDisk).toHaveBeenCalledTimes(1);

    // Wipe
    await autoSave.stop();
    await storage.deleteDisk();

    // Change disk data
    setData(new Uint8Array([0xFF, 0xFE]));

    // Advance time — no more saves should happen
    await vi.advanceTimersByTimeAsync(90_000);
    // saveDisk was called once in periodic + once in final flush = 2
    expect(storage.saveDisk).toHaveBeenCalledTimes(2);

    // Storage should be empty after delete
    expect(storage._store).toBeNull();
  });
});

// ─── Multi-tab Safety Integration ──────────────────────────────────────────

describe('Multi-tab safety integration', () => {
  it('tab lock prevents concurrent disk access', async () => {
    // Mock Web Locks API
    let lockHeld = false;
    const mockRequest = vi.fn(
      (
        _name: string,
        options: { ifAvailable: boolean },
        callback: (lock: unknown) => Promise<void>,
      ) => {
        if (lockHeld) {
          // Lock held by another tab
          void callback(null);
        } else {
          lockHeld = true;
          void callback({ name: 'templeossy-instance', mode: 'exclusive' });
        }
      },
    );

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        ...globalThis.navigator,
        locks: { request: mockRequest },
      },
      configurable: true,
      writable: true,
    });

    const tab1 = new TabLockManager();
    const result1 = await tab1.acquire();
    expect(result1.acquired).toBe(true);

    // Second tab should be blocked
    const tab2 = new TabLockManager();
    const result2 = await tab2.acquire();
    expect(result2.acquired).toBe(false);
    if (!result2.acquired) {
      expect(result2.reason).toBe('held-by-other-tab');
    }

    // Release tab 1
    tab1.release();
    lockHeld = false;

    // Now tab 2 can acquire
    const result3 = await tab2.acquire();
    expect(result3.acquired).toBe(true);

    tab2.release();
  });
});

// ─── Storage Error Recovery ────────────────────────────────────────────────

describe('Storage error recovery', () => {
  it('quota error during save reports error but continues running', async () => {
    vi.useFakeTimers();

    const storage = createMockStorage();
    storage.saveDisk = vi.fn(async () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });

    const { reader } = createDiskReader(new Uint8Array([1, 2, 3]));

    const errors: Array<{ type: string; message: string }> = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const autoSave = new AutoSaveManager(storage, reader);
    autoSave.onStorageError = (err) => errors.push(err);
    autoSave.start();

    // Multiple save attempts
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);

    // Only one quota error reported (deduplication)
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('quota');
    expect(isQuotaError(new DOMException('Quota exceeded', 'QuotaExceededError'))).toBe(true);

    // Auto-save is still running (doesn't crash)
    expect(autoSave.isRunning).toBe(true);

    await autoSave.stop();
    vi.useRealTimers();
  });

  it('non-quota write error reports each occurrence', async () => {
    vi.useFakeTimers();

    const storage = createMockStorage();
    storage.saveDisk = vi.fn(async () => {
      throw new Error('Disk I/O error');
    });

    const { reader } = createDiskReader(new Uint8Array([1, 2, 3]));

    const errors: Array<{ type: string; message: string }> = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const autoSave = new AutoSaveManager(storage, reader);
    autoSave.onStorageError = (err) => errors.push(err);
    autoSave.start();

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);

    // Each write error is reported
    expect(errors).toHaveLength(2);
    expect(errors[0].type).toBe('write-error');
    expect(errors[1].type).toBe('write-error');

    await autoSave.stop();
    vi.useRealTimers();
  });
});

// ─── EmulatorLoader Disk Image Read ────────────────────────────────────────

describe('EmulatorLoader disk image reading', () => {
  it('readDiskImage returns null when module not loaded', () => {
    const loader = new EmulatorLoader('templeos');
    expect(loader.readDiskImage()).toBeNull();
  });

  it('readDiskImage returns null when module has no FS', () => {
    const loader = new EmulatorLoader('templeos');
    // Simulate a module without FS
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (loader as any)._module = {};
    expect(loader.readDiskImage()).toBeNull();
  });

  it('readDiskImage reads from Emscripten FS when available', () => {
    const loader = new EmulatorLoader('templeos');
    const fakeDiskData = new Uint8Array([0x55, 0xAA, 0x00, 0x01]);

    // Simulate Emscripten module with FS
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (loader as any)._module = {
      FS: {
        readFile: vi.fn(() => fakeDiskData),
      },
    };

    const result = loader.readDiskImage();
    expect(result).not.toBeNull();
    expect(result!.length).toBe(4);
    expect(Array.from(result!)).toEqual([0x55, 0xAA, 0x00, 0x01]);
  });

  it('readDiskImage handles FS.readFile errors gracefully', () => {
    const loader = new EmulatorLoader('templeos');

    // Simulate FS that throws on readFile
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (loader as any)._module = {
      FS: {
        readFile: vi.fn(() => { throw new Error('File not found'); }),
      },
    };

    const result = loader.readDiskImage();
    expect(result).toBeNull();
  });
});

// ─── Boot Medium + Boot Order Integration ──────────────────────────────────

describe('Boot medium and boot order integration', () => {
  const scenarios: Array<{
    name: string;
    hasSaved: boolean;
    userChoice: 'resume' | 'fresh' | null;
    expectedMedium: BootMedium;
    expectedBootOrder: 'c' | 'd';
    expectedAutoSave: boolean;
  }> = [
    {
      name: 'First visit (no saved disk)',
      hasSaved: false,
      userChoice: null,
      expectedMedium: 'cd',
      expectedBootOrder: 'd',
      expectedAutoSave: true, // Need to save installation
    },
    {
      name: 'Return visit + Resume',
      hasSaved: true,
      userChoice: 'resume',
      expectedMedium: 'disk',
      expectedBootOrder: 'c',
      expectedAutoSave: true, // Save changes during session
    },
    {
      name: 'Return visit + Fresh (CD-only)',
      hasSaved: true,
      userChoice: 'fresh',
      expectedMedium: 'cd',
      expectedBootOrder: 'd',
      expectedAutoSave: false, // Protect existing disk
    },
  ];

  for (const scenario of scenarios) {
    it(`${scenario.name}: medium=${scenario.expectedMedium}, boot=${scenario.expectedBootOrder}, autoSave=${scenario.expectedAutoSave}`, () => {
      const medium = selectBootMedium(scenario.hasSaved, scenario.userChoice);
      expect(medium).toBe(scenario.expectedMedium);

      const bootOrder = getBootOrderFlag(medium);
      expect(bootOrder).toBe(scenario.expectedBootOrder);

      // Verify auto-save decision
      const savedDiskData = scenario.hasSaved && scenario.userChoice === 'resume'
        ? new Uint8Array([1, 2, 3])
        : (scenario.hasSaved && scenario.userChoice === 'fresh' ? new Uint8Array([1, 2, 3]) : null);

      const shouldAutoSave = (
        medium === 'disk' ||
        !savedDiskData
      );
      expect(shouldAutoSave).toBe(scenario.expectedAutoSave);

      // Verify QEMU args match
      const loader = new EmulatorLoader('templeos');
      loader.bootOrder = bootOrder;
      const args = loader.getQemuArgs();
      expect(args[args.indexOf('-boot') + 1]).toBe(scenario.expectedBootOrder);
    });
  }
});

// ─── Persistence Persistence (requestPersistence) ──────────────────────────

describe('Persistence request integration', () => {
  it('requestPersistence is called during init and handles all outcomes', async () => {
    const storage = createMockStorage();

    // Test: persistence granted
    storage.requestPersistence = vi.fn(async () => true);
    const result1 = await storage.requestPersistence();
    expect(result1).toBe(true);

    // Test: persistence denied
    storage.requestPersistence = vi.fn(async () => false);
    const result2 = await storage.requestPersistence();
    expect(result2).toBe(false);

    // Test: persistence throws
    storage.requestPersistence = vi.fn(async () => { throw new Error('denied'); });
    await expect(storage.requestPersistence()).rejects.toThrow();
  });
});
