/**
 * emulator.ts — Emscripten QEMU module loader with initialization phase tracking
 * and comprehensive error handling.
 *
 * Supports two boot modes:
 * - 'templeos': Boot from TempleOS ISO CD-ROM (default)
 * - 'linux-poc': Boot a minimal Linux kernel + initramfs for display pipeline verification
 */

/** Boot mode for the emulator. */
export type BootMode = 'templeos' | 'linux-poc';

// Initialization phases
export type EmulatorPhase =
  | 'idle'
  | 'downloading'
  | 'compiling'
  | 'initializing'
  | 'ready'
  | 'error';

export interface EmulatorError {
  type: ErrorType;
  message: string;
  remediation: string;
  original?: unknown;
}

export type ErrorType =
  | 'compile'
  | 'link'
  | 'oom'
  | 'worker'
  | 'network'
  | 'shared-array-buffer'
  | 'unknown';

export type PhaseChangeHandler = (phase: EmulatorPhase, error?: EmulatorError) => void;
export type DownloadProgressHandler = (loaded: number, total: number) => void;

/**
 * Classify an error into a specific ErrorType with user-friendly message and remediation.
 */
export function classifyError(err: unknown): EmulatorError {
  const errMsg = err instanceof Error ? err.message : String(err);
  const errName = err instanceof Error ? err.name : '';

  // WebAssembly.CompileError
  if (err instanceof WebAssembly.CompileError || errName === 'CompileError') {
    return {
      type: 'compile',
      message: 'Failed to compile the WebAssembly module.',
      remediation:
        'Please try a different browser (Chrome or Firefox recommended). Your browser may not support the required WebAssembly features.',
      original: err,
    };
  }

  // WebAssembly.LinkError
  if (err instanceof WebAssembly.LinkError || errName === 'LinkError') {
    return {
      type: 'link',
      message: 'Failed to link the WebAssembly module.',
      remediation:
        'This may indicate a corrupted download. Please refresh the page and try again.',
      original: err,
    };
  }

  // RangeError — OOM for large memory allocation (2300MB)
  if (
    err instanceof RangeError ||
    errName === 'RangeError' ||
    /out of memory/i.test(errMsg) ||
    /memory/i.test(errMsg)
  ) {
    return {
      type: 'oom',
      message: 'Not enough memory to run the emulator (requires ~2.3 GB).',
      remediation:
        'Close other browser tabs and applications to free up memory, then refresh this page.',
      original: err,
    };
  }

  // Worker creation failure
  if (
    /worker/i.test(errMsg) ||
    /could not create/i.test(errMsg) ||
    /failed to construct/i.test(errMsg)
  ) {
    return {
      type: 'worker',
      message: 'Failed to create a Web Worker for the emulator.',
      remediation:
        'Your browser may be blocking Web Workers. Please ensure JavaScript is fully enabled and try again.',
      original: err,
    };
  }

  // Network errors
  if (
    /network/i.test(errMsg) ||
    /fetch/i.test(errMsg) ||
    /404/i.test(errMsg) ||
    /failed to load/i.test(errMsg) ||
    errName === 'TypeError'
  ) {
    return {
      type: 'network',
      message: 'Failed to download emulator files.',
      remediation:
        'Please check your internet connection and refresh the page. If the problem persists, try disabling ad blockers or VPN.',
      original: err,
    };
  }

  // SharedArrayBuffer not available
  if (/sharedarraybuffer/i.test(errMsg)) {
    return {
      type: 'shared-array-buffer',
      message: 'SharedArrayBuffer is not available in this browser context.',
      remediation:
        'This site requires special HTTP headers (COOP/COEP) to enable SharedArrayBuffer. Please ensure you are accessing the site over HTTPS or localhost.',
      original: err,
    };
  }

  // Unknown error
  return {
    type: 'unknown',
    message: `An unexpected error occurred: ${errMsg}`,
    remediation: 'Please refresh the page and try again. If the problem persists, try a different browser.',
    original: err,
  };
}

/**
 * Check if SharedArrayBuffer is available (requires COOP/COEP headers).
 */
export function checkSharedArrayBuffer(): EmulatorError | null {
  if (typeof SharedArrayBuffer === 'undefined') {
    return {
      type: 'shared-array-buffer',
      message: 'SharedArrayBuffer is not available in this browser context.',
      remediation:
        'This site requires Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers. Please access the site via the dev server (localhost:3200).',
    };
  }
  return null;
}

/**
 * EmulatorLoader manages the lifecycle of loading and initializing the Emscripten QEMU module.
 */
export class EmulatorLoader {
  private _phase: EmulatorPhase = 'idle';
  private _error: EmulatorError | null = null;
  private _onPhaseChange: PhaseChangeHandler | null = null;
  private _onDownloadProgress: DownloadProgressHandler | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _module: any = null;
  private _bootMode: BootMode;

  constructor(bootMode: BootMode = 'templeos') {
    this._bootMode = bootMode;
  }

  get phase(): EmulatorPhase {
    return this._phase;
  }

  get error(): EmulatorError | null {
    return this._error;
  }

  get bootMode(): BootMode {
    return this._bootMode;
  }

  /** The loaded Emscripten Module object (available after 'ready' phase). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get module(): any {
    return this._module;
  }

  set onPhaseChange(handler: PhaseChangeHandler | null) {
    this._onPhaseChange = handler;
  }

  set onDownloadProgress(handler: DownloadProgressHandler | null) {
    this._onDownloadProgress = handler;
  }

  private setPhase(phase: EmulatorPhase, error?: EmulatorError): void {
    this._phase = phase;
    if (error) {
      this._error = error;
    }
    this._onPhaseChange?.(phase, error);
  }

  /**
   * Get QEMU arguments for the current boot mode.
   */
  getQemuArgs(): string[] {
    if (this._bootMode === 'linux-poc') {
      return [
        '-m', '256M',
        '-smp', '1',
        '-kernel', '/pack/vmlinuz',
        '-initrd', '/pack/initramfs.gz',
        '-append', 'console=ttyS0 console=tty0 earlyprintk=vga',
        '-vga', 'std',
        '-display', 'emscripten',
        '-rtc', 'base=localtime',
        '-accel', 'tcg,tb-size=500',
        '-nic', 'none',
        '-L', '/pack',
      ];
    }

    // Default: TempleOS boot
    return [
      '-m', '512M',
      '-smp', '1',
      '-cdrom', '/pack/TempleOSCDV5.03.ISO',
      '-boot', 'd',
      '-vga', 'std',
      '-display', 'emscripten',
      '-rtc', 'base=localtime',
      '-accel', 'tcg,tb-size=500',
      '-nic', 'none',
      '-L', '/pack',
    ];
  }

  /**
   * Build the Emscripten Module configuration object.
   */
  buildModuleConfig(): Record<string, unknown> {
    const config: Record<string, unknown> = {
      // QEMU arguments
      arguments: this.getQemuArgs(),
      // Locate files in /emulator/ subdirectory
      locateFile: (path: string) => `/emulator/${path}`,
      // Main script URL for Web Worker
      mainScriptUrlOrBlob: '/emulator/qemu-system-x86_64.js',
      // Suppress auto-run so we control lifecycle
      noInitialRun: false,
      // Status callback used by load.js for download progress
      setStatus: (text: string) => {
        const match = text.match(/\((\d+)\/(\d+)\)/);
        if (match) {
          const loaded = parseInt(match[1], 10);
          const total = parseInt(match[2], 10);
          this._onDownloadProgress?.(loaded, total);
        }
      },
      // Print handlers for debug logging
      print: (text: string) => {
        console.log('[QEMU]', text);
      },
      printErr: (text: string) => {
        console.warn('[QEMU]', text);
      },
    };

    // For Linux PoC: inject kernel + initramfs into Emscripten FS via preRun
    if (this._bootMode === 'linux-poc') {
      config.preRun = [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(config.preRun as Array<() => void> || []),
      ];
    }

    return config;
  }

  /**
   * Fetch a binary file and return it as a Uint8Array.
   */
  private async fetchBinary(url: string): Promise<Uint8Array> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  /**
   * Load and initialize the QEMU Emscripten module.
   */
  async load(): Promise<void> {
    // Phase 1: Check prerequisites
    const sabError = checkSharedArrayBuffer();
    if (sabError) {
      this.setPhase('error', sabError);
      return;
    }

    try {
      // Phase 2: Download
      this.setPhase('downloading');

      // For Linux PoC, fetch kernel + initramfs before starting
      let linuxKernel: Uint8Array | null = null;
      let linuxInitramfs: Uint8Array | null = null;

      if (this._bootMode === 'linux-poc') {
        [linuxKernel, linuxInitramfs] = await Promise.all([
          this.fetchBinary('/linux-poc/vmlinuz'),
          this.fetchBinary('/linux-poc/initramfs.gz'),
        ]);
      }

      // Load the data file packager (load.js) first — it sets up preRun hooks
      // The load.js script expects a global Module object
      const moduleConfig = this.buildModuleConfig();

      // For Linux PoC: add a preRun callback to inject kernel+initramfs into the FS
      if (this._bootMode === 'linux-poc' && linuxKernel && linuxInitramfs) {
        const existingPreRun = (moduleConfig.preRun as Array<() => void>) || [];
        moduleConfig.preRun = [
          ...existingPreRun,
          function () {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const FS = (globalThis as any).Module.FS;
            if (FS) {
              // Ensure /pack directory exists (created by load.js data packager)
              try { FS.mkdir('/pack'); } catch { /* already exists */ }
              FS.writeFile('/pack/vmlinuz', linuxKernel);
              FS.writeFile('/pack/initramfs.gz', linuxInitramfs);
              console.log('[Linux PoC] Injected kernel and initramfs into /pack/');
            }
          },
        ];
      }

      // Set Module global for load.js
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).Module = moduleConfig;

      // Dynamically load load.js (data file packager)
      await this.loadScript('/emulator/load.js');

      // Phase 3: Compiling Wasm
      this.setPhase('compiling');

      // Dynamically import the QEMU JS glue
      // The JS glue expects Module to be a global
      await this.loadScript('/emulator/qemu-system-x86_64.js');

      // Phase 4: Initializing
      this.setPhase('initializing');

      // Store module reference for later use by other features (display, input)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this._module = (globalThis as any).Module;

      // Phase 5: Ready
      this.setPhase('ready');
    } catch (err: unknown) {
      const emulatorError = classifyError(err);
      this.setPhase('error', emulatorError);
    }
  }

  /**
   * Dynamically load a script tag and wait for it to execute.
   */
  private loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () =>
        reject(new Error(`Failed to load script: ${src}`));
      document.head.appendChild(script);
    });
  }
}
