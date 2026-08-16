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

/** Where a PE's attribute certificate table starts. */
const certificateTableOffset = (file: Buffer): number => {
  const peOffset = file.readUInt32LE(0x3c);
  const optionalHeaderOffset = peOffset + 24;
  const isPe32Plus = file.readUInt16LE(optionalHeaderOffset) === 0x20b;
  return file.readUInt32LE(optionalHeaderOffset + (isPe32Plus ? 112 : 96) + 4 * 8);
};

/** A real PE whose PKCS#7 blob is garbled, with its WIN_CERTIFICATE header left well-formed. */
const unparseableSignaturePe = (name: string): string => {
  const file = fs.readFileSync(SIGNED_PE);
  const tableOffset = certificateTableOffset(file);
  file.fill(0xff, tableOffset + 8, tableOffset + 64);
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

  it('refuses to touch a signature it cannot parse, rather than replacing it', () => {
    // "I could not read this signature" is not "this signature is bad" — it may be valid and merely
    // beyond the parser. Replacing it would destroy a working signature, the worst outcome
    // available, so it gets its own class and CI complains instead. This is deliberately narrow:
    // only a well-formed certificate table whose PKCS#7 will not parse qualifies.
    expect(classifyBinary(unparseableSignaturePe('unparseable.exe'))).toBe('skip-unreadable-signature');
    // Distinct from a plain digest mismatch, which we do replace.
    expect(classifyBinary(tamperedPe())).toBe('sign');
  });

  it.each([
    // Each of these is something Windows itself treats as unsigned, so there is no working
    // signature to preserve and we must sign over it. They must NOT be confused with a signature we
    // merely failed to parse — an earlier revision lumped them together and silently deferred to
    // certificate tables Windows would have rejected.
    ['a non-PKCS certificate type', 6, 0x0001, 2 as const],
    ['an unknown certificate revision', 4, 0x0100, 2 as const],
    ['a length that overruns its table', 0, 0xffffff, 4 as const],
  ])('signs a binary with %s', (label, offset, value, width) => {
    const file = fs.readFileSync(SIGNED_PE);
    const tableOffset = certificateTableOffset(file);
    if (width === 2) {
      file.writeUInt16LE(value, tableOffset + offset);
    } else {
      file.writeUInt32LE(value, tableOffset + offset);
    }
    expect(classifyBinary(writeTemp(`hdr-${offset}-${value}.exe`, file))).toBe('sign');
  });

  it('signs a file that is not a PE at all rather than silently skipping it', () => {
    expect(classifyBinary(writeTemp('text.dll', Buffer.from('not a binary at all')))).toBe('sign');
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

const restoreEnv = (values: Record<string, string | undefined>): void => {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

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

  it('does not sign a binary whose signature it failed to parse', () => {
    expect(attemptedToSign(unparseableSignaturePe('unparseable-sign.exe'))).toBe(false);
  });

  it('appends to the record instead of truncating it', () => {
    // Several electron-builder processes can share one record. If the hook truncated, whichever
    // started last would wipe the others' entries and the check would report those binaries as
    // never offered — turning a merely stale record into a spurious failure. Freshness is the
    // caller's job; build.yml deletes the record before building.
    const record = path.join(makeTempDir(), 'offered.txt');
    const first = unsignedPe('first.exe');
    const second = unsignedPe('second.exe');
    const previous = process.env.SIGNING_DRY_RUN;
    process.env.SIGNING_DRY_RUN = record;
    try {
      sign({ path: first });
      sign({ path: second });
    } finally {
      restoreEnv({ SIGNING_DRY_RUN: previous });
    }
    expect(fs.readFileSync(record, 'utf8').trim().split('\n')).toEqual([first, second]);
  });

  it.each([
    ['OSSIGN_CONFIG', '{"pretend":"real signing config"}'],
    ['OSSIGN_CONFIG_BASE64', 'e30='],
    // Defined-but-empty still reaches the ossign CLI, which gates on `!== undefined`, so
    // truthiness here would let the contradiction through.
    ['OSSIGN_CONFIG', ''],
  ])('refuses to run when a dry run is requested alongside %s', (key, value) => {
    const previous = { dry: process.env.SIGNING_DRY_RUN, config: process.env[key] };
    process.env.SIGNING_DRY_RUN = path.join(makeTempDir(), 'offered.txt');
    process.env[key] = value;
    try {
      expect(() => sign({ path: unsignedPe(`contested-${key}-${value.length}.exe`) })).toThrow(
        /SIGNING_DRY_RUN is set together with/
      );
    } finally {
      restoreEnv({ SIGNING_DRY_RUN: previous.dry, [key]: previous.config });
    }
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
