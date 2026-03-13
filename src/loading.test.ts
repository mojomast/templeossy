import { describe, it, expect } from 'vitest';
import {
  getStatusMessage,
  formatProgress,
  calculateProgress,
} from './loading';
import type { EmulatorPhase } from './emulator';

describe('getStatusMessage', () => {
  it('returns correct message for idle phase', () => {
    expect(getStatusMessage('idle')).toBe('Preparing...');
  });

  it('returns correct message for downloading phase', () => {
    expect(getStatusMessage('downloading')).toContain('Downloading');
  });

  it('returns correct message for compiling phase', () => {
    expect(getStatusMessage('compiling')).toContain('Compiling');
  });

  it('returns correct message for initializing phase', () => {
    expect(getStatusMessage('initializing')).toContain('Preparing emulator');
  });

  it('returns correct message for ready phase', () => {
    expect(getStatusMessage('ready')).toContain('ready');
  });

  it('returns correct message for error phase', () => {
    expect(getStatusMessage('error')).toContain('error');
  });

  it('returns a non-empty string for all known phases', () => {
    const phases: EmulatorPhase[] = [
      'idle',
      'downloading',
      'compiling',
      'initializing',
      'ready',
      'error',
    ];
    for (const phase of phases) {
      const msg = getStatusMessage(phase);
      expect(msg.length).toBeGreaterThan(0);
    }
  });
});

describe('formatProgress', () => {
  it('formats bytes into MB with percentage', () => {
    const result = formatProgress(5 * 1024 * 1024, 10 * 1024 * 1024);
    expect(result).toContain('5.0');
    expect(result).toContain('10.0');
    expect(result).toContain('50%');
  });

  it('handles zero total', () => {
    const result = formatProgress(0, 0);
    expect(result).toContain('0%');
  });

  it('handles complete download', () => {
    const total = 18129920;
    const result = formatProgress(total, total);
    expect(result).toContain('100%');
  });

  it('handles partial download', () => {
    const result = formatProgress(1024 * 1024, 18 * 1024 * 1024);
    expect(result).toContain('1.0');
    expect(result).toContain('18.0');
  });
});

describe('calculateProgress', () => {
  it('returns 0 for zero total', () => {
    expect(calculateProgress(0, 0)).toBe(0);
  });

  it('returns 0 for negative total', () => {
    expect(calculateProgress(100, -1)).toBe(0);
  });

  it('returns 50 for half done', () => {
    expect(calculateProgress(50, 100)).toBe(50);
  });

  it('returns 100 for complete', () => {
    expect(calculateProgress(100, 100)).toBe(100);
  });

  it('caps at 100', () => {
    expect(calculateProgress(200, 100)).toBe(100);
  });

  it('rounds to nearest integer', () => {
    expect(calculateProgress(1, 3)).toBe(33);
  });
});
