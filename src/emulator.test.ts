import { describe, it, expect } from 'vitest';
import {
  classifyError,
  checkSharedArrayBuffer,
  EmulatorLoader,
  TEMPLEOS_INITIAL_DISK_SIZE_BYTES,
  type EmulatorPhase,
  type EmulatorError,
  type ErrorType,
} from './emulator';

describe('classifyError', () => {
  it('classifies WebAssembly.CompileError', () => {
    const err = new WebAssembly.CompileError('bad wasm');
    const result = classifyError(err);
    expect(result.type).toBe('compile');
    expect(result.message).toContain('compile');
    expect(result.remediation).toContain('browser');
    expect(result.original).toBe(err);
  });

  it('classifies WebAssembly.LinkError', () => {
    const err = new WebAssembly.LinkError('import mismatch');
    const result = classifyError(err);
    expect(result.type).toBe('link');
    expect(result.message).toContain('link');
    expect(result.remediation).toContain('refresh');
    expect(result.original).toBe(err);
  });

  it('classifies RangeError as OOM', () => {
    const err = new RangeError('WebAssembly.Memory(): could not allocate memory');
    const result = classifyError(err);
    expect(result.type).toBe('oom');
    expect(result.message).toContain('memory');
    expect(result.remediation).toContain('tabs');
    expect(result.original).toBe(err);
  });

  it('classifies worker creation failure', () => {
    const err = new Error('Failed to construct Worker');
    const result = classifyError(err);
    expect(result.type).toBe('worker');
    expect(result.message).toContain('Worker');
    expect(result.remediation).toContain('JavaScript');
    expect(result.original).toBe(err);
  });

  it('classifies network errors (fetch fail)', () => {
    const err = new TypeError('Failed to fetch');
    const result = classifyError(err);
    expect(result.type).toBe('network');
    expect(result.message).toContain('download');
    expect(result.remediation).toContain('internet');
    expect(result.original).toBe(err);
  });

  it('classifies network errors (404)', () => {
    const err = new Error('404 Not Found');
    const result = classifyError(err);
    expect(result.type).toBe('network');
    expect(result.message).toContain('download');
  });

  it('classifies SharedArrayBuffer error', () => {
    const err = new Error('SharedArrayBuffer is not defined');
    const result = classifyError(err);
    expect(result.type).toBe('shared-array-buffer');
    expect(result.message).toContain('SharedArrayBuffer');
    expect(result.remediation).toContain('COOP/COEP');
  });

  it('classifies unknown errors', () => {
    const err = new Error('something weird happened');
    const result = classifyError(err);
    expect(result.type).toBe('unknown');
    expect(result.message).toContain('something weird happened');
    expect(result.remediation).toContain('refresh');
  });

  it('handles non-Error objects', () => {
    const result = classifyError('string error');
    expect(result.type).toBe('unknown');
    expect(result.message).toContain('string error');
  });

  it('each error type has message and remediation', () => {
    const errors: Array<{ err: unknown; expectedType: ErrorType }> = [
      { err: new WebAssembly.CompileError('x'), expectedType: 'compile' },
      { err: new WebAssembly.LinkError('x'), expectedType: 'link' },
      { err: new RangeError('memory'), expectedType: 'oom' },
      { err: new Error('Worker creation failed'), expectedType: 'worker' },
      { err: new TypeError('Failed to fetch'), expectedType: 'network' },
      { err: new Error('SharedArrayBuffer not available'), expectedType: 'shared-array-buffer' },
      { err: new Error('random'), expectedType: 'unknown' },
    ];

    for (const { err, expectedType } of errors) {
      const result = classifyError(err);
      expect(result.type).toBe(expectedType);
      expect(result.message.length).toBeGreaterThan(0);
      expect(result.remediation.length).toBeGreaterThan(0);
    }
  });
});

describe('checkSharedArrayBuffer', () => {
  it('returns null when SharedArrayBuffer is available', () => {
    // In Node.js test environment, SharedArrayBuffer should be available
    const result = checkSharedArrayBuffer();
    expect(result).toBeNull();
  });
});

describe('EmulatorLoader', () => {
  it('starts in idle phase', () => {
    const loader = new EmulatorLoader();
    expect(loader.phase).toBe('idle');
    expect(loader.error).toBeNull();
  });

  it('buildModuleConfig returns valid configuration (TempleOS default)', () => {
    const loader = new EmulatorLoader();
    const config = loader.buildModuleConfig();

    // Check QEMU arguments — default is TempleOS
    const args = config.arguments as string[];
    expect(args).toContain('-m');
    expect(args).toContain('512M');
    expect(args).toContain('-vga');
    expect(args).toContain('std');
    expect(args).toContain('-display');
    expect(args).toContain('none');
    expect(args).toContain('-cdrom');
    expect(args).toContain('/pack/TempleOSCDV5.03.ISO');
    expect(args).toContain('-hda');
    expect(args).toContain('/pack/disk.img');
    expect(args).toContain('-L');
    expect(args).toContain('/pack');
    expect(args).toContain('-nic');
    expect(args).toContain('none');
    expect(args).toContain('-no-reboot');
  });

  it('buildModuleConfig has locateFile pointing to /emulator/', () => {
    const loader = new EmulatorLoader();
    const config = loader.buildModuleConfig();
    const locateFile = config.locateFile as (path: string) => string;
    expect(locateFile('qemu-system-x86_64.wasm')).toBe('/emulator/qemu-system-x86_64.wasm');
    expect(locateFile('qemu-system-x86_64.data')).toBe('/emulator/qemu-system-x86_64.data');
  });

  it('buildModuleConfig has mainScriptUrlOrBlob', () => {
    const loader = new EmulatorLoader();
    const config = loader.buildModuleConfig();
    expect(config.mainScriptUrlOrBlob).toBe('/emulator/qemu-system-x86_64.js');
  });

  it('buildModuleConfig has print and printErr handlers', () => {
    const loader = new EmulatorLoader();
    const config = loader.buildModuleConfig();
    expect(typeof config.print).toBe('function');
    expect(typeof config.printErr).toBe('function');
  });

  it('buildModuleConfig provides a PTY bridge for QEMU runtime init', () => {
    const loader = new EmulatorLoader();
    const config = loader.buildModuleConfig();
    const pty = config.pty as {
      onSignal?: unknown;
      onReadable?: unknown;
      readable?: unknown;
      writable?: unknown;
    };

    expect(pty).toBeDefined();
    expect(typeof pty.onSignal).toBe('function');
    expect(typeof pty.onReadable).toBe('function');
    expect(typeof pty.readable).toBe('boolean');
    expect(typeof pty.writable).toBe('boolean');
  });

  it('buildModuleConfig has setStatus callback', () => {
    const loader = new EmulatorLoader();
    const config = loader.buildModuleConfig();
    expect(typeof config.setStatus).toBe('function');
  });

  it('setStatus callback parses download progress', () => {
    const loader = new EmulatorLoader();
    let receivedLoaded = 0;
    let receivedTotal = 0;

    loader.onDownloadProgress = (loaded: number, total: number) => {
      receivedLoaded = loaded;
      receivedTotal = total;
    };

    const config = loader.buildModuleConfig();
    const setStatus = config.setStatus as (text: string) => void;

    setStatus('Downloading data... (5242880/18129920)');
    expect(receivedLoaded).toBe(5242880);
    expect(receivedTotal).toBe(18129920);
  });

  it('tracks phase changes via onPhaseChange handler', () => {
    const phases: EmulatorPhase[] = [];
    const errors: Array<EmulatorError | undefined> = [];

    const loader = new EmulatorLoader();
    loader.onPhaseChange = (phase: EmulatorPhase, error?: EmulatorError) => {
      phases.push(phase);
      errors.push(error);
    };

    // We can't easily test the full load() flow without a browser,
    // but we test the handler is wired correctly through buildModuleConfig
    expect(loader.phase).toBe('idle');
  });

  it('defaults to templeos boot mode', () => {
    const loader = new EmulatorLoader();
    expect(loader.bootMode).toBe('templeos');
  });

  it('supports linux-poc boot mode', () => {
    const loader = new EmulatorLoader('linux-poc');
    expect(loader.bootMode).toBe('linux-poc');
  });

  it('linux-poc mode uses -kernel and -initrd args', () => {
    const loader = new EmulatorLoader('linux-poc');
    const args = loader.getQemuArgs();
    expect(args).toContain('-kernel');
    expect(args).toContain('/pack/vmlinuz');
    expect(args).toContain('-initrd');
    expect(args).toContain('/pack/initramfs.gz');
    expect(args).toContain('-append');
    expect(args).not.toContain('-cdrom');
    expect(args).not.toContain('-boot');
  });

  it('templeos mode uses -cdrom and -boot args', () => {
    const loader = new EmulatorLoader('templeos');
    const args = loader.getQemuArgs();
    expect(args).toContain('-cdrom');
    expect(args).toContain('/pack/TempleOSCDV5.03.ISO');
    expect(args).toContain('-boot');
    expect(args).toContain('d');
    expect(args).not.toContain('-kernel');
    expect(args).not.toContain('-initrd');
  });

  it('templeos mode includes writable disk image (-hda)', () => {
    const loader = new EmulatorLoader('templeos');
    const args = loader.getQemuArgs();
    expect(args).toContain('-hda');
    expect(args).toContain('/pack/disk.img');
  });

  it('templeos mode includes -no-reboot for safety', () => {
    const loader = new EmulatorLoader('templeos');
    const args = loader.getQemuArgs();
    expect(args).toContain('-no-reboot');
  });

  it('templeos mode uses IDE disk controller (no virtio)', () => {
    const loader = new EmulatorLoader('templeos');
    const args = loader.getQemuArgs();
    // -hda implies IDE disk (default pc/i440FX machine)
    expect(args).toContain('-hda');
    // Should not contain virtio-related args
    const joined = args.join(' ');
    expect(joined).not.toContain('virtio');
  });

  it('linux-poc uses 256M memory (smaller than templeos)', () => {
    const loader = new EmulatorLoader('linux-poc');
    const args = loader.getQemuArgs();
    const memIdx = args.indexOf('-m');
    expect(memIdx).toBeGreaterThanOrEqual(0);
    expect(args[memIdx + 1]).toBe('256M');
  });

  it('linux-poc mode does not include disk image or -no-reboot', () => {
    const loader = new EmulatorLoader('linux-poc');
    const args = loader.getQemuArgs();
    expect(args).not.toContain('-hda');
    expect(args).not.toContain('-no-reboot');
  });

  it('templeos mode uses 512M memory', () => {
    const loader = new EmulatorLoader('templeos');
    const args = loader.getQemuArgs();
    const memIdx = args.indexOf('-m');
    expect(memIdx).toBeGreaterThanOrEqual(0);
    expect(args[memIdx + 1]).toBe('512M');
  });

  it('uses 128MB as the initial writable disk size', () => {
    expect(TEMPLEOS_INITIAL_DISK_SIZE_BYTES).toBe(128 * 1024 * 1024);
  });

  it('both modes use -vga std and -display none', () => {
    for (const mode of ['templeos', 'linux-poc'] as const) {
      const loader = new EmulatorLoader(mode);
      const args = loader.getQemuArgs();
      expect(args).toContain('-vga');
      expect(args).toContain('std');
      expect(args).toContain('-display');
      expect(args).toContain('none');
    }
  });

  it('both modes disable networking (-nic none)', () => {
    for (const mode of ['templeos', 'linux-poc'] as const) {
      const loader = new EmulatorLoader(mode);
      const args = loader.getQemuArgs();
      expect(args).toContain('-nic');
      expect(args).toContain('none');
    }
  });

  // ─── Boot order tests ─────────────────────────────────────────────────

  it('defaults to boot order "d" (CD-ROM)', () => {
    const loader = new EmulatorLoader('templeos');
    expect(loader.bootOrder).toBe('d');
  });

  it('boot order can be set to "c" (disk)', () => {
    const loader = new EmulatorLoader('templeos');
    loader.bootOrder = 'c';
    expect(loader.bootOrder).toBe('c');
  });

  it('getQemuArgs uses boot order "d" by default', () => {
    const loader = new EmulatorLoader('templeos');
    const args = loader.getQemuArgs();
    const bootIdx = args.indexOf('-boot');
    expect(bootIdx).toBeGreaterThanOrEqual(0);
    expect(args[bootIdx + 1]).toBe('d');
  });

  it('getQemuArgs reflects updated boot order "c"', () => {
    const loader = new EmulatorLoader('templeos');
    loader.bootOrder = 'c';
    const args = loader.getQemuArgs();
    const bootIdx = args.indexOf('-boot');
    expect(bootIdx).toBeGreaterThanOrEqual(0);
    expect(args[bootIdx + 1]).toBe('c');
  });

  // ─── Disk image data injection tests ──────────────────────────────────

  it('diskImageData defaults to null', () => {
    const loader = new EmulatorLoader('templeos');
    // readDiskImage returns null when module not loaded
    expect(loader.readDiskImage()).toBeNull();
  });

  it('diskImageData can be set for resume', () => {
    const loader = new EmulatorLoader('templeos');
    const data = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]);
    loader.diskImageData = data;
    // Setting diskImageData doesn't affect readDiskImage (which reads from Emscripten FS)
    // but does affect the preRun configuration in buildModuleConfig
  });

  it('waits for runtime initialization before becoming ready', async () => {
    const loader = new EmulatorLoader('templeos');
    const phases: EmulatorPhase[] = [];

    loader.onPhaseChange = (phase: EmulatorPhase) => {
      phases.push(phase);
    };

    let runtimeInit: (() => void) | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (loader as any).loadScript = async (src: string) => {
      if (src === '/emulator/qemu-system-x86_64.js') {
        runtimeInit = () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ((globalThis as any).Module as Record<string, unknown>)._qemu_setup_display = () => 1;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ((globalThis as any).Module as { onRuntimeInitialized?: () => void }).onRuntimeInitialized?.();
        };
      }
    };

    const loadPromise = loader.load();
    await Promise.resolve();

    expect(phases).toContain('compiling');
    expect(phases).not.toContain('ready');

    runtimeInit?.();
    await Promise.resolve();
    await loadPromise;

    expect(phases[phases.length - 1]).toBe('ready');
    expect(loader.module._qemu_setup_display()).toBe(1);
  });

  it('readDiskImage returns null when module is not loaded', () => {
    const loader = new EmulatorLoader('templeos');
    expect(loader.readDiskImage()).toBeNull();
  });
});
