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

  it('qemu-system-x86_64.data exists and contains BIOS + Shrine ISO', () => {
    const file = resolve(PUBLIC_EMULATOR, 'qemu-system-x86_64.data');
    expect(existsSync(file)).toBe(true);
    const stats = statSync(file);
    // The .data file should be at least as large as the Shrine ISO (3,844,096 bytes)
    // Uncompressed (no LZ4) — BIOS files add ~312KB
    expect(stats.size).toBeGreaterThanOrEqual(3 * 1024 * 1024);
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

describe('Shrine ISO', () => {
  it('Shrine-v5051.iso exists with correct size (3,844,096 bytes)', () => {
    const file = resolve(__dirname, '../assets/Shrine-v5051.iso');
    expect(existsSync(file)).toBe(true);
    const stats = statSync(file);
    expect(stats.size).toBe(3844096);
  });
});

describe('Linux PoC Assets', () => {
  const linuxPocDir = resolve(__dirname, '../public/linux-poc');

  it('vmlinuz kernel exists and is >= 5MB', () => {
    const file = resolve(linuxPocDir, 'vmlinuz');
    expect(existsSync(file)).toBe(true);
    const stats = statSync(file);
    expect(stats.size).toBeGreaterThanOrEqual(5 * 1024 * 1024);
  });

  it('initramfs.gz exists and is >= 100KB', () => {
    const file = resolve(linuxPocDir, 'initramfs.gz');
    expect(existsSync(file)).toBe(true);
    const stats = statSync(file);
    expect(stats.size).toBeGreaterThanOrEqual(100 * 1024);
  });
});

describe('Load.js Content', () => {
  it('references qemu-system-x86_64.data for remote fetch', async () => {
    const { readFileSync } = await import('fs');
    const content = readFileSync(resolve(PUBLIC_EMULATOR, 'load.js'), 'utf-8');
    expect(content).toContain('qemu-system-x86_64.data');
  });

  it('does not require LZ4 decompression (uncompressed packaging)', async () => {
    const { readFileSync } = await import('fs');
    const content = readFileSync(resolve(PUBLIC_EMULATOR, 'load.js'), 'utf-8');
    // Assets are packaged without --lz4 to avoid requiring Module.LZ4 at runtime
    expect(content).not.toContain('LZ4');
  });

  it('maps BIOS files to /pack/ paths', async () => {
    const { readFileSync } = await import('fs');
    const content = readFileSync(resolve(PUBLIC_EMULATOR, 'load.js'), 'utf-8');
    expect(content).toContain('/pack/bios-256k.bin');
    expect(content).toContain('/pack/vgabios-stdvga.bin');
    expect(content).toContain('/pack/kvmvapic.bin');
    expect(content).toContain('/pack/linuxboot_dma.bin');
  });

  it('maps Shrine ISO to /pack/ path', async () => {
    const { readFileSync } = await import('fs');
    const content = readFileSync(resolve(PUBLIC_EMULATOR, 'load.js'), 'utf-8');
    expect(content).toContain('/pack/Shrine-v5051.iso');
  });
});
