/* eslint-disable @typescript-eslint/no-require-imports */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';

const { sign, classifyBinary, exemptionFor, EXEMPTIONS } = require('./customSign.js') as {
  sign: (configuration: { path: string }) => void;
  classifyBinary: (filePath: string) => string;
  exemptionFor: (filePath: string) => { expectedSigner: string; reason: string } | null;
  EXEMPTIONS: { pattern: RegExp; expectedSigner: string; reason: string }[];
};

const CONPTY_DIR = path.join(__dirname, '..', 'node_modules', 'node-pty', 'third_party', 'conpty');
const SIGNED_PE = path.join(CONPTY_DIR, fs.readdirSync(CONPTY_DIR).sort()[0]!, 'win10-x64', 'OpenConsole.exe');

const tempDirs: string[] = [];

const makeTempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'customsign-'));
  tempDirs.push(dir);
  return dir;
};

const writeTemp = (name: string, contents: Buffer): string => {
  const filePath = path.join(makeTempDir(), name);
  fs.writeFileSync(filePath, contents);
  return filePath;
};

/** A real PE with its certificate table entry blanked — i.e. genuinely unsigned. */
const unsignedPe = (name = 'unsigned.exe'): string => {
  const file = fs.readFileSync(SIGNED_PE);
  const peOffset = file.readUInt32LE(0x3c);
  const optionalHeaderOffset = peOffset + 24;
  const isPe32Plus = file.readUInt16LE(optionalHeaderOffset) === 0x20b;
  const securityDirectoryOffset = optionalHeaderOffset + (isPe32Plus ? 112 : 96) + 4 * 8;
  file.writeUInt32LE(0, securityDirectoryOffset);
  file.writeUInt32LE(0, securityDirectoryOffset + 4);
  return writeTemp(name, file);
};

/** A real PE modified after signing: certificate present, but it no longer describes the file. */
const tamperedPe = (): string => {
  const file = fs.readFileSync(SIGNED_PE);
  file[0x1000] ^= 0xff;
  return writeTemp('tampered.exe', file);
};

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('classifyBinary', () => {
  it('signs an unsigned binary', () => {
    expect(classifyBinary(unsignedPe())).toBe('sign');
  });

  it('leaves an intact third-party signature alone', () => {
    // Stripping Microsoft's signature to replace it with ours is never the safe move — their
    // certificate carries Smart App Control reputation a newer identity does not.
    expect(classifyBinary(SIGNED_PE)).toBe('skip-already-signed');
  });

  it('signs a binary whose certificate no longer matches its contents', () => {
    // Windows treats this as unsigned, so signing it is a strict improvement rather than a loss.
    expect(classifyBinary(tamperedPe())).toBe('sign');
  });

  it('decides from the file, not from a path list', () => {
    // The regression this guards: d3dcompiler_47.dll ships Microsoft-signed inside Electron, and a
    // path-based policy had already missed it once and would have stripped its signature.
    const disguised = writeTemp('anything-at-all.dll', fs.readFileSync(SIGNED_PE));
    expect(exemptionFor(disguised)).toBeNull();
    expect(classifyBinary(disguised)).toBe('skip-already-signed');
  });
});

describe('exemptionFor', () => {
  const UNPACKED = 'D:\\a\\launcher\\launcher\\dist\\win-unpacked';
  const NODE_PTY = `${UNPACKED}\\resources\\app.asar.unpacked\\node_modules\\node-pty`;

  it.each([
    [`${NODE_PTY}\\third_party\\conpty\\1.20.240626001\\win10-x64\\OpenConsole.exe`],
    [`${NODE_PTY}\\third_party\\conpty\\1.20.240626001\\win10-x64\\conpty.dll`],
    [`${NODE_PTY}\\third_party\\conpty\\1.20.240626001\\win10-arm64\\OpenConsole.exe`],
    [`${NODE_PTY}\\build\\Release\\conpty\\OpenConsole.exe`],
    [`${UNPACKED}\\d3dcompiler_47.dll`],
  ])('declares %s as pre-signed by Microsoft', (filePath) => {
    expect(exemptionFor(filePath)?.expectedSigner).toBe('Microsoft Corporation');
  });

  it.each([
    // Electron's other root DLLs are unsigned upstream and we sign them ourselves.
    [`${UNPACKED}\\ffmpeg.dll`],
    [`${UNPACKED}\\libEGL.dll`],
    [`${UNPACKED}\\vk_swiftshader.dll`],
    // node-pty's own build output sits one level up from the conpty directories and must not
    // inherit their exemption.
    [`${NODE_PTY}\\build\\Release\\winpty-agent.exe`],
    [`${NODE_PTY}\\build\\Release\\conpty.node`],
    [`${NODE_PTY}\\build\\Release\\conpty_console_list.node`],
    // Our own artifacts.
    [`${UNPACKED}\\Invoke Community Edition.exe`],
    [`${UNPACKED}\\resources\\bin\\uv.exe`],
    [`${UNPACKED}\\resources\\elevate.exe`],
  ])('does not declare %s', (filePath) => {
    expect(exemptionFor(filePath)).toBeNull();
  });

  it('accepts forward slashes as well as backslashes', () => {
    const posix =
      '/home/runner/dist/win-unpacked/resources/app.asar.unpacked/node_modules/node-pty/third_party/conpty/1.20.240626001/win10-x64/conpty.dll';
    expect(exemptionFor(posix)?.expectedSigner).toBe('Microsoft Corporation');
  });

  it('gives every exemption a reason, so CI failures explain themselves', () => {
    for (const exemption of EXEMPTIONS) {
      expect(exemption.reason).toBeTruthy();
      expect(exemption.expectedSigner).toBeTruthy();
    }
  });
});

describe('sign', () => {
  /**
   * `sign()` is the function electron-builder actually calls, and it is awkward to test because
   * signing shells out to the ossign CLI. The `OSSIGN_CONFIG` guard makes that observable without
   * ever invoking it: reaching the signing step with no config throws, so "did it throw?" answers
   * "would it have signed this file?".
   */
  const attemptedToSign = (filePath: string): boolean => {
    const { OSSIGN_CONFIG, OSSIGN_CONFIG_BASE64, SIGNING_DRY_RUN } = process.env;
    delete process.env.OSSIGN_CONFIG;
    delete process.env.OSSIGN_CONFIG_BASE64;
    delete process.env.SIGNING_DRY_RUN;
    try {
      sign({ path: filePath });
      return false;
    } catch (error) {
      expect((error as Error).message).toMatch(/OSSIGN_CONFIG/);
      return true;
    } finally {
      process.env.OSSIGN_CONFIG = OSSIGN_CONFIG;
      process.env.OSSIGN_CONFIG_BASE64 = OSSIGN_CONFIG_BASE64;
      process.env.SIGNING_DRY_RUN = SIGNING_DRY_RUN;
      for (const [key, value] of Object.entries({ OSSIGN_CONFIG, OSSIGN_CONFIG_BASE64, SIGNING_DRY_RUN })) {
        if (value === undefined) {
          delete process.env[key];
        }
      }
    }
  };

  it('signs an unsigned binary', () => {
    expect(attemptedToSign(unsignedPe('to-sign.exe'))).toBe(true);
  });

  it('refuses to sign over an intact third-party signature', () => {
    // The regression that motivated deciding from file contents: Electron ships a Microsoft-signed
    // d3dcompiler_47.dll, and signing over it would replace Microsoft's Smart App Control
    // reputation with ours.
    expect(attemptedToSign(SIGNED_PE)).toBe(false);
  });

  it('signs a binary whose certificate no longer matches, since Windows sees it as unsigned', () => {
    expect(attemptedToSign(tamperedPe())).toBe(true);
  });

  it('records what it was offered instead of signing when SIGNING_DRY_RUN is set', () => {
    const record = path.join(makeTempDir(), 'nested', 'offered.txt');
    const target = unsignedPe('dry-run.exe');
    const previous = process.env.SIGNING_DRY_RUN;
    process.env.SIGNING_DRY_RUN = record;
    try {
      // No OSSIGN_CONFIG is set, so reaching the signing step would throw.
      sign({ path: target });
    } finally {
      if (previous === undefined) {
        delete process.env.SIGNING_DRY_RUN;
      } else {
        process.env.SIGNING_DRY_RUN = previous;
      }
    }
    expect(fs.readFileSync(record, 'utf8').trim().split('\n')).toContain(target);
  });
});
