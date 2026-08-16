/* eslint-disable @typescript-eslint/no-require-imports */

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';

const { readOfferedPaths, isPortableExecutable, comparablePath } = require('./checkWindowsSigningCoverage.js') as {
  readOfferedPaths: (recordPath: string) => Set<string>;
  isPortableExecutable: (filePath: string) => boolean;
  comparablePath: (filePath: string, platform?: string) => string;
};

const SCRIPT = path.join(__dirname, 'checkWindowsSigningCoverage.js');
const CONPTY_DIR = path.join(__dirname, '..', 'node_modules', 'node-pty', 'third_party', 'conpty');
const SIGNED_PE = path.join(CONPTY_DIR, fs.readdirSync(CONPTY_DIR).sort()[0]!, 'win10-x64', 'OpenConsole.exe');

const tempDirs: string[] = [];

const makeTempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-'));
  tempDirs.push(dir);
  return dir;
};

const unsignedPeBytes = (): Buffer => {
  const file = fs.readFileSync(SIGNED_PE);
  const peOffset = file.readUInt32LE(0x3c);
  const optionalHeaderOffset = peOffset + 24;
  const isPe32Plus = file.readUInt16LE(optionalHeaderOffset) === 0x20b;
  const securityDirectoryOffset = optionalHeaderOffset + (isPe32Plus ? 112 : 96) + 4 * 8;
  file.writeUInt32LE(0, securityDirectoryOffset);
  file.writeUInt32LE(0, securityDirectoryOffset + 4);
  return file;
};

/**
 * Build a miniature `win-unpacked` plus the dry-run record the real build would have produced.
 * `offer` selects which of the tree's binaries the signing hook was handed.
 */
const makeTree = (files: Record<string, Buffer>, offer: (name: string) => boolean = () => true) => {
  const root = makeTempDir();
  const offered: string[] = [];
  for (const [name, contents] of Object.entries(files)) {
    const filePath = path.join(root, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
    if (offer(name)) {
      offered.push(filePath);
    }
  }
  const recordPath = path.join(makeTempDir(), 'offered.txt');
  fs.writeFileSync(recordPath, `${offered.join('\n')}\n`);
  return { root, recordPath };
};

const run = (root: string, recordPath: string): { code: number; output: string } => {
  try {
    return { code: 0, output: execFileSync('node', [SCRIPT, root, recordPath], { encoding: 'utf8' }) };
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };
    return { code: failure.status, output: `${failure.stdout}${failure.stderr}` };
  }
};

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('isPortableExecutable', () => {
  it('recognises a real PE', () => {
    expect(isPortableExecutable(SIGNED_PE)).toBe(true);
  });

  it('recognises a PE regardless of its extension', () => {
    // Smart App Control gates file contents, not names, so the sweep must not rely on extensions.
    const dir = makeTempDir();
    for (const name of ['mystery.pyd', 'no-extension']) {
      fs.writeFileSync(path.join(dir, name), fs.readFileSync(SIGNED_PE));
      expect(isPortableExecutable(path.join(dir, name))).toBe(true);
    }
  });

  it('rejects non-PE files', () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, 'empty.dll'), Buffer.alloc(0));
    // An MZ header with no PE signature is a DOS executable, not a PE.
    const dosOnly = Buffer.alloc(0x40);
    dosOnly.writeUInt16LE(0x5a4d, 0);
    fs.writeFileSync(path.join(dir, 'dos.exe'), dosOnly);

    expect(isPortableExecutable(path.join(__dirname, 'customSign.js'))).toBe(false);
    expect(isPortableExecutable(path.join(dir, 'empty.dll'))).toBe(false);
    expect(isPortableExecutable(path.join(dir, 'dos.exe'))).toBe(false);
  });

  it('does not throw on a directory or a missing file', () => {
    expect(isPortableExecutable(__dirname)).toBe(false);
    expect(isPortableExecutable(path.join(__dirname, 'nope.exe'))).toBe(false);
  });
});

describe('comparablePath', () => {
  // The two sides of the reachability comparison are built independently, and Windows filesystems
  // are case-insensitive, so two spellings of one path are one file.
  const mixed = path.join(path.sep, 'Some', 'Path', 'App.exe');
  const lower = path.join(path.sep, 'some', 'path', 'app.exe');

  it('resolves relative paths so both sides are comparable', () => {
    expect(comparablePath('dist/win-unpacked')).toBe(comparablePath(path.resolve('dist/win-unpacked')));
  });

  it('treats two spellings of one path as equal on Windows', () => {
    // The platform is injectable so this branch is exercised on the Linux test runner too — the
    // suite never runs on Windows, and an untested branch here fails the whole check closed.
    expect(comparablePath(mixed, 'win32')).toBe(comparablePath(lower, 'win32'));
  });

  it('keeps them distinct off Windows, where case is significant', () => {
    expect(comparablePath(mixed, 'linux')).not.toBe(comparablePath(lower, 'linux'));
  });
});

describe('readOfferedPaths', () => {
  it('fails when the record is missing', () => {
    expect(() => readOfferedPaths(path.join(makeTempDir(), 'absent.txt'))).toThrow(/no dry-run record/);
  });

  it('fails when the hook was never called', () => {
    const recordPath = path.join(makeTempDir(), 'offered.txt');
    fs.writeFileSync(recordPath, '\n  \n');
    expect(() => readOfferedPaths(recordPath)).toThrow(/never called/);
  });
});

describe('the coverage check', () => {
  it('passes when every binary was offered and pre-signed ones are declared', () => {
    const { root, recordPath } = makeTree({
      'app.exe': unsignedPeBytes(),
      'd3dcompiler_47.dll': fs.readFileSync(SIGNED_PE),
    });
    const { code, output } = run(root, recordPath);
    expect(output).toMatch(/signing coverage OK/);
    expect(code).toBe(0);
  });

  it('fails on a shipped binary the signing hook was never offered', () => {
    // The failure the dry-run record exists to catch: electron-builder only walks certain
    // directories, so a PE in the wrong place ships unsigned no matter what the policy says.
    const { root, recordPath } = makeTree(
      { 'app.exe': unsignedPeBytes(), 'locales/stray.dll': unsignedPeBytes() },
      (name) => name === 'app.exe'
    );
    const { code, output } = run(root, recordPath);
    expect(output).toMatch(/never offered it to the signing hook/);
    expect(output).toContain('stray.dll');
    expect(code).toBe(1);
  });

  it('fails on a pre-signed binary nobody declared', () => {
    // We refuse to strip a third-party signature, so such a file stops being signed by us. That
    // has to be declared rather than quietly start happening.
    const { root, recordPath } = makeTree({ 'surprise.dll': fs.readFileSync(SIGNED_PE) });
    const { code, output } = run(root, recordPath);
    expect(output).toMatch(/nothing.*declares that/s);
    expect(code).toBe(1);
  });

  it('fails on a binary whose signature could not be parsed', () => {
    // customSign.js declines to touch these rather than risk destroying a valid signature, so they
    // end up with nobody's signature verified and nobody's applied. Somebody has to look.
    const file = fs.readFileSync(SIGNED_PE);
    const peOffset = file.readUInt32LE(0x3c);
    const optionalHeaderOffset = peOffset + 24;
    const isPe32Plus = file.readUInt16LE(optionalHeaderOffset) === 0x20b;
    const tableOffset = file.readUInt32LE(optionalHeaderOffset + (isPe32Plus ? 112 : 96) + 4 * 8);
    file.fill(0xff, tableOffset + 8, tableOffset + 64);

    const { root, recordPath } = makeTree({ 'app.exe': unsignedPeBytes(), 'odd.dll': file });
    const { code, output } = run(root, recordPath);
    expect(output).toMatch(/could not parse/);
    // The reason from authenticode.js must reach the message, not just the static prefix.
    expect(output).toMatch(/signature could not be parsed/);
    expect(output).toContain('odd.dll');
    expect(code).toBe(1);
  });

  it('does not let a declaration excuse a signature that no longer matches the file', () => {
    // Being listed in EXEMPTIONS must not be a free pass. Windows treats a binary whose digest no
    // longer matches as unsigned, so we sign it ourselves rather than leaving it as-is — even
    // though its path is declared.
    const tampered = fs.readFileSync(SIGNED_PE);
    tampered[0x1000] ^= 0xff;
    const { root, recordPath } = makeTree({ 'd3dcompiler_47.dll': tampered });
    const { code, output } = run(root, recordPath);
    expect(output).toMatch(/^sign \(1\):\n {2}d3dcompiler_47\.dll$/m);
    expect(output).toMatch(/signing coverage OK/);
    expect(code).toBe(0);
  });
});
