/**
 * storage.ts — Browser storage abstraction for disk image persistence.
 *
 * Provides OPFS (Origin Private File System) as primary storage with
 * IndexedDB as fallback. Handles creating, saving, loading, and deleting
 * virtual disk images for TempleOS persistence across browser sessions.
 *
 * API:
 *   detectStorageBackend()  — returns 'opfs' | 'indexeddb'
 *   createDisk(sizeBytes)   — create empty sparse disk image
 *   saveDisk(data)          — save disk image to browser storage
 *   loadDisk()              — load disk image from browser storage
 *   deleteDisk()            — delete disk image from browser storage
 *   hasSavedDisk()          — check if a saved disk image exists
 *   requestPersistence()    — request navigator.storage.persist()
 */

/** Storage backend type. */
export type StorageBackend = 'opfs' | 'indexeddb';

/** Disk image file name in OPFS. */
const OPFS_DISK_FILENAME = 'disk.img';

/** IndexedDB database and store names. */
const IDB_DB_NAME = 'templeossy-storage';
const IDB_STORE_NAME = 'disk-images';
const IDB_DISK_KEY = 'disk.img';

/**
 * Detect the best available storage backend.
 * Prefers OPFS if navigator.storage.getDirectory is available.
 * Falls back to IndexedDB otherwise.
 */
export function detectStorageBackend(): StorageBackend {
  if (
    typeof navigator !== 'undefined' &&
    navigator.storage &&
    typeof navigator.storage.getDirectory === 'function'
  ) {
    return 'opfs';
  }
  return 'indexeddb';
}

/**
 * Request persistent storage to reduce eviction risk.
 * Returns true if persistence was granted, false otherwise.
 */
export async function requestPersistence(): Promise<boolean> {
  if (
    typeof navigator !== 'undefined' &&
    navigator.storage &&
    typeof navigator.storage.persist === 'function'
  ) {
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
  return false;
}

// ─── OPFS Backend ──────────────────────────────────────────────────────────

/**
 * Get the OPFS root directory handle.
 */
async function getOPFSRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

/**
 * Check if a saved disk exists in OPFS.
 */
async function opfsHasSavedDisk(): Promise<boolean> {
  try {
    const root = await getOPFSRoot();
    await root.getFileHandle(OPFS_DISK_FILENAME);
    return true;
  } catch {
    return false;
  }
}

/**
 * Save disk image data to OPFS.
 */
async function opfsSaveDisk(data: Uint8Array): Promise<void> {
  const root = await getOPFSRoot();
  const fileHandle = await root.getFileHandle(OPFS_DISK_FILENAME, { create: true });
  const writable = await fileHandle.createWritable();
  // Copy to a plain ArrayBuffer to satisfy FileSystemWritableFileStream type
  // (Uint8Array from Wasm memory may use SharedArrayBuffer)
  const copy = new Uint8Array(data);
  await writable.write(copy as unknown as Uint8Array<ArrayBuffer>);
  await writable.close();
}

/**
 * Load disk image data from OPFS.
 * Returns null if no saved disk exists.
 */
async function opfsLoadDisk(): Promise<Uint8Array | null> {
  try {
    const root = await getOPFSRoot();
    const fileHandle = await root.getFileHandle(OPFS_DISK_FILENAME);
    const file = await fileHandle.getFile();
    const buffer = await file.arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

/**
 * Delete disk image from OPFS.
 */
async function opfsDeleteDisk(): Promise<void> {
  try {
    const root = await getOPFSRoot();
    await root.removeEntry(OPFS_DISK_FILENAME);
  } catch {
    // File may not exist — that's fine
  }
}

// ─── IndexedDB Backend ─────────────────────────────────────────────────────

/**
 * Open the IndexedDB database.
 */
function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Check if a saved disk exists in IndexedDB.
 */
async function idbHasSavedDisk(): Promise<boolean> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readonly');
    const store = tx.objectStore(IDB_STORE_NAME);
    const request = store.getKey(IDB_DISK_KEY);
    request.onsuccess = () => {
      db.close();
      resolve(request.result !== undefined);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

/**
 * Save disk image data to IndexedDB.
 */
async function idbSaveDisk(data: Uint8Array): Promise<void> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    const store = tx.objectStore(IDB_STORE_NAME);
    const request = store.put(data, IDB_DISK_KEY);
    request.onsuccess = () => {
      db.close();
      resolve();
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

/**
 * Load disk image data from IndexedDB.
 * Returns null if no saved disk exists.
 */
async function idbLoadDisk(): Promise<Uint8Array | null> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readonly');
    const store = tx.objectStore(IDB_STORE_NAME);
    const request = store.get(IDB_DISK_KEY);
    request.onsuccess = () => {
      db.close();
      const result = request.result;
      if (result instanceof Uint8Array) {
        resolve(result);
      } else if (result instanceof ArrayBuffer) {
        resolve(new Uint8Array(result));
      } else if (result === undefined) {
        resolve(null);
      } else {
        resolve(null);
      }
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

/**
 * Delete disk image from IndexedDB.
 */
async function idbDeleteDisk(): Promise<void> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    const store = tx.objectStore(IDB_STORE_NAME);
    const request = store.delete(IDB_DISK_KEY);
    request.onsuccess = () => {
      db.close();
      resolve();
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

// ─── DiskStorage class ─────────────────────────────────────────────────────

/**
 * DiskStorage provides a unified API for disk image persistence,
 * automatically selecting the best available storage backend.
 */
export class DiskStorage {
  private _backend: StorageBackend;

  constructor(backend?: StorageBackend) {
    this._backend = backend ?? detectStorageBackend();
  }

  /** The active storage backend ('opfs' or 'indexeddb'). */
  get backend(): StorageBackend {
    return this._backend;
  }

  /**
   * Check if a saved disk image exists in browser storage.
   */
  async hasSavedDisk(): Promise<boolean> {
    try {
      if (this._backend === 'opfs') {
        return await opfsHasSavedDisk();
      }
      return await idbHasSavedDisk();
    } catch {
      return false;
    }
  }

  /**
   * Create an empty sparse disk image of the given size.
   * Returns a Uint8Array suitable for writing to the Emscripten FS.
   *
   * Note: We don't save a full 2GB array to storage. Instead we create
   * a minimal placeholder. The actual disk image will be saved after QEMU
   * writes to it.
   */
  createDisk(_sizeBytes: number): Uint8Array {
    // Return empty array — QEMU will use truncate for sparse file
    return new Uint8Array(0);
  }

  /**
   * Save disk image data to browser storage.
   */
  async saveDisk(data: Uint8Array): Promise<void> {
    if (this._backend === 'opfs') {
      return opfsSaveDisk(data);
    }
    return idbSaveDisk(data);
  }

  /**
   * Load disk image from browser storage.
   * Returns null if no saved disk exists.
   */
  async loadDisk(): Promise<Uint8Array | null> {
    if (this._backend === 'opfs') {
      return opfsLoadDisk();
    }
    return idbLoadDisk();
  }

  /**
   * Delete disk image from browser storage.
   */
  async deleteDisk(): Promise<void> {
    if (this._backend === 'opfs') {
      return opfsDeleteDisk();
    }
    return idbDeleteDisk();
  }

  /**
   * Request persistent storage to reduce eviction risk.
   */
  async requestPersistence(): Promise<boolean> {
    return requestPersistence();
  }
}

// ─── Boot medium selection ─────────────────────────────────────────────────

/** Boot medium: CD-ROM or hard disk. */
export type BootMedium = 'cd' | 'disk';

/**
 * Determine the boot medium based on user choice and disk availability.
 *
 * - First visit (no disk): boot from CD
 * - Return visit + resume: boot from disk
 * - Return visit + fresh: boot from CD (disk still attached)
 */
export function selectBootMedium(
  hasSavedDisk: boolean,
  userChoice: 'resume' | 'fresh' | null,
): BootMedium {
  // First visit — no saved disk — boot from CD
  if (!hasSavedDisk) return 'cd';

  // Return visit — user chose to resume — boot from disk
  if (userChoice === 'resume') return 'disk';

  // Return visit — user chose fresh — boot from CD
  return 'cd';
}

/**
 * Get the QEMU boot order flag for a given boot medium.
 * -boot d = CD-ROM, -boot c = hard disk
 */
export function getBootOrderFlag(medium: BootMedium): 'c' | 'd' {
  return medium === 'disk' ? 'c' : 'd';
}

// ─── Auto-save manager ────────────────────────────────────────────────────

/** Auto-save interval in milliseconds (30 seconds). */
const AUTO_SAVE_INTERVAL_MS = 30_000;

/**
 * Callback type to read the current disk image data from the emulator.
 * Returns null if the disk data is not available or has not been written to.
 */
export type DiskDataReader = () => Uint8Array | null;

/**
 * AutoSaveManager periodically flushes the disk image to browser storage
 * and also flushes on beforeunload.
 */
export class AutoSaveManager {
  private storage: DiskStorage;
  private readDiskData: DiskDataReader;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private _isRunning = false;
  private boundBeforeUnload: (() => void) | null = null;

  constructor(storage: DiskStorage, readDiskData: DiskDataReader) {
    this.storage = storage;
    this.readDiskData = readDiskData;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Start auto-saving: periodic flush every 30 seconds + beforeunload handler.
   */
  start(): void {
    if (this._isRunning) return;

    this._isRunning = true;

    // Periodic save
    this.intervalId = setInterval(() => {
      void this.flush();
    }, AUTO_SAVE_INTERVAL_MS);

    // Save on tab close
    this.boundBeforeUnload = () => {
      this.flushSync();
    };
    window.addEventListener('beforeunload', this.boundBeforeUnload);
  }

  /**
   * Stop auto-saving and perform a final flush.
   */
  async stop(): Promise<void> {
    if (!this._isRunning) return;

    this._isRunning = false;

    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.boundBeforeUnload) {
      window.removeEventListener('beforeunload', this.boundBeforeUnload);
      this.boundBeforeUnload = null;
    }

    // Final flush
    await this.flush();
  }

  /**
   * Flush disk data to storage asynchronously.
   */
  async flush(): Promise<void> {
    try {
      const data = this.readDiskData();
      if (data && data.length > 0) {
        await this.storage.saveDisk(data);
      }
    } catch (err) {
      console.warn('[AutoSave] Failed to save disk:', err);
    }
  }

  /**
   * Synchronous flush for beforeunload handler.
   * Uses the async flush but doesn't await it — the browser may or may not
   * complete it before closing the tab.
   */
  private flushSync(): void {
    try {
      const data = this.readDiskData();
      if (data && data.length > 0) {
        // Fire and forget — browser gives us limited time in beforeunload
        void this.storage.saveDisk(data);
      }
    } catch {
      // Best effort — can't do much in beforeunload
    }
  }
}
