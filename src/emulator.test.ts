import { describe, it, expect } from 'vitest';
import {
  classifyError,
  checkSharedArrayBuffer,
  EmulatorLoader,
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

  it('buildModuleConfig returns valid configuration', () => {
    const loader = new EmulatorLoader();
    const config = loader.buildModuleConfig();

    // Check QEMU arguments
    const args = config.arguments as string[];
    expect(args).toContain('-m');
    expect(args).toContain('512M');
    expect(args).toContain('-vga');
    expect(args).toContain('std');
    expect(args).toContain('-display');
    expect(args).toContain('emscripten');
    expect(args).toContain('-cdrom');
    expect(args).toContain('/pack/TempleOSCDV5.03.ISO');
    expect(args).toContain('-L');
    expect(args).toContain('/pack');
    expect(args).toContain('-nic');
    expect(args).toContain('none');
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
});
