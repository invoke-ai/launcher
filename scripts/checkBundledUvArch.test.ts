/* eslint-disable @typescript-eslint/no-require-imports */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';

const { assertUvMatchesArch, readPeMachine, PE_MACHINE } = require('./checkBundledUvArch.js') as {
  assertUvMatchesArch: (uvPath: string, arch: string) => void;
  readPeMachine: (filePath: string) => number | undefined;
  PE_MACHINE: Record<'x64' | 'arm64', number>;
};

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uv-arch-'));

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/** A minimal PE image: the MZ header pointing at a PE signature and COFF `Machine` field. */
const writePe = (name: string, machine: number): string => {
  const buf = Buffer.alloc(0x90);
  buf.writeUInt16LE(0x5a4d, 0);
  buf.writeUInt32LE(0x80, 0x3c);
  buf.writeUInt32LE(0x00004550, 0x80);
  buf.writeUInt16LE(machine, 0x84);
  const filePath = path.join(tempDir, name);
  fs.writeFileSync(filePath, buf);
  return filePath;
};

describe('checkBundledUvArch', () => {
  const x64Uv = writePe('uv-x64.exe', PE_MACHINE.x64);
  const arm64Uv = writePe('uv-arm64.exe', PE_MACHINE.arm64);

  it('reads the PE machine type', () => {
    expect(readPeMachine(x64Uv)).toBe(0x8664);
    expect(readPeMachine(arm64Uv)).toBe(0xaa64);
    const notPe = path.join(tempDir, 'not-pe');
    fs.writeFileSync(notPe, '#!/bin/sh\n'.repeat(10));
    expect(readPeMachine(notPe)).toBeUndefined();
  });

  it('accepts the uv built for the packaged architecture', () => {
    expect(() => assertUvMatchesArch(x64Uv, 'x64')).not.toThrow();
    expect(() => assertUvMatchesArch(arm64Uv, 'arm64')).not.toThrow();
  });

  it('refuses the other architecture, a missing uv, and an architecture it has no check for', () => {
    expect(() => assertUvMatchesArch(x64Uv, 'arm64')).toThrow(/x64 build.*npm run download win-arm64/);
    expect(() => assertUvMatchesArch(arm64Uv, 'x64')).toThrow(/arm64 build.*npm run download win`/);
    expect(() => assertUvMatchesArch(path.join(tempDir, 'missing.exe'), 'x64')).toThrow(/does not exist/);
    expect(() => assertUvMatchesArch(x64Uv, 'ia32')).toThrow(/No uv architecture check/);
  });
});
