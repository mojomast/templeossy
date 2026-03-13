import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'fs';
import { resolve } from 'path';

const PUBLIC_EMULATOR = resolve(__dirname, '../public/emulator');

describe('Build Artifacts', () => {
  it('qemu-system-x86_64.wasm exists and is >= 20MB', () => {
    const file = resolve(PUBLIC_EMULATOR, 'qemu-system-x86_64.wasm');
    expect(existsSync(file)).toBe(true);
    const stats = statSync(file);
    expect(stats.size).toBeGreaterThanOrEqual(20 * 1024 * 1024);
  });

  it('qemu-system-x86_64.js exists and is non-empty', () => {
    const file = resolve(PUBLIC_EMULATOR, 'qemu-system-x86_64.js');
    expect(existsSync(file)).toBe(true);
    const stats = statSync(file);
    expect(stats.size).toBeGreaterThan(1000);
  });

  it('qemu-system-x86_64.data exists and contains BIOS + ISO', () => {
    const file = resolve(PUBLIC_EMULATOR, 'qemu-system-x86_64.data');
    expect(existsSync(file)).toBe(true);
    const stats = statSync(file);
    // The .data file should be at least as large as the ISO (17,817,600 bytes)
    // With LZ4 compression it may be smaller, but BIOS files add ~312KB
    // The compressed size should be at least 15MB
    expect(stats.size).toBeGreaterThanOrEqual(15 * 1024 * 1024);
  });

  it('load.js exists and is non-empty', () => {
    const file = resolve(PUBLIC_EMULATOR, 'load.js');
    expect(existsSync(file)).toBe(true);
    const stats = statSync(file);
    expect(stats.size).toBeGreaterThan(1000);
  });
});

describe('BIOS Files in Source', () => {
  const biosDir = resolve(__dirname, '../build/output/bios');

  it('bios-256k.bin exists (~256KB)', () => {
    const file = resolve(biosDir, 'bios-256k.bin');
    expect(existsSync(file)).toBe(true);
    const stats = statSync(file);
    expect(stats.size).toBe(262144); // Exactly 256KB
  });

  it('vgabios-stdvga.bin exists (~40-65KB)', () => {
    const file = resolve(biosDir, 'vgabios-stdvga.bin');
    expect(existsSync(file)).toBe(true);
    const stats = statSync(file);
    expect(stats.size).toBeGreaterThanOrEqual(30000);
    expect(stats.size).toBeLessThanOrEqual(70000);
  });

  it('kvmvapic.bin exists', () => {
    const file = resolve(biosDir, 'kvmvapic.bin');
    expect(existsSync(file)).toBe(true);
    const stats = statSync(file);
    expect(stats.size).toBeGreaterThan(0);
  });

  it('linuxboot_dma.bin exists', () => {
    const file = resolve(biosDir, 'linuxboot_dma.bin');
    expect(existsSync(file)).toBe(true);
    const stats = statSync(file);
    expect(stats.size).toBeGreaterThan(0);
  });
});

describe('TempleOS ISO', () => {
  it('TempleOSCDV5.03.ISO exists with correct size (17,817,600 bytes)', () => {
    const file = resolve(__dirname, '../assets/TempleOSCDV5.03.ISO');
    expect(existsSync(file)).toBe(true);
    const stats = statSync(file);
    expect(stats.size).toBe(17817600);
  });
});

describe('Load.js Content', () => {
  it('references qemu-system-x86_64.data for remote fetch', async () => {
    const { readFileSync } = await import('fs');
    const content = readFileSync(resolve(PUBLIC_EMULATOR, 'load.js'), 'utf-8');
    expect(content).toContain('qemu-system-x86_64.data');
  });

  it('includes LZ4 decompression support', async () => {
    const { readFileSync } = await import('fs');
    const content = readFileSync(resolve(PUBLIC_EMULATOR, 'load.js'), 'utf-8');
    // LZ4 compressed packages contain decompression logic
    expect(content).toContain('LZ4');
  });

  it('maps BIOS files to /pack/ paths', async () => {
    const { readFileSync } = await import('fs');
    const content = readFileSync(resolve(PUBLIC_EMULATOR, 'load.js'), 'utf-8');
    expect(content).toContain('/pack/bios-256k.bin');
    expect(content).toContain('/pack/vgabios-stdvga.bin');
    expect(content).toContain('/pack/kvmvapic.bin');
    expect(content).toContain('/pack/linuxboot_dma.bin');
  });

  it('maps TempleOS ISO to /pack/ path', async () => {
    const { readFileSync } = await import('fs');
    const content = readFileSync(resolve(PUBLIC_EMULATOR, 'load.js'), 'utf-8');
    expect(content).toContain('/pack/TempleOSCDV5.03.ISO');
  });
});
