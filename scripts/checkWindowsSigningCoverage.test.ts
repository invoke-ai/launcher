import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readEmbeddedCertificate, verifyExpectedSigner } = require('./checkWindowsSigningCoverage.js') as {
  readEmbeddedCertificate: (filePath: string) => { signed: boolean; certificate?: Buffer };
  verifyExpectedSigner: (filePath: string, expectedSigner: string) => string | null;
};

/**
 * A real Microsoft-signed PE, shipped in node-pty's npm tarball on every platform, so this works
 * as a fixture on Linux/macOS CI too. The signing check exists to tell "Microsoft already signed
 * this" apart from "this is unsigned", so test it against the genuine article.
 */
const SIGNED_PE = path.join(
  __dirname,
  '..',
  'node_modules',
  'node-pty',
  'third_party',
  'conpty',
  '1.20.240626001',
  'win10-x64',
  'OpenConsole.exe'
);

const tempFiles: string[] = [];

/** Copy a PE and blank its IMAGE_DIRECTORY_ENTRY_SECURITY entry, producing an unsigned PE. */
const makeUnsignedCopy = (source: string): string => {
  const file = fs.readFileSync(source);
  const peOffset = file.readUInt32LE(0x3c);
  const optionalHeaderOffset = peOffset + 24;
  const magic = file.readUInt16LE(optionalHeaderOffset);
  const certificateTableOffset = optionalHeaderOffset + (magic === 0x20b ? 112 : 96) + 4 * 8;
  file.writeUInt32LE(0, certificateTableOffset);
  file.writeUInt32LE(0, certificateTableOffset + 4);

  const destination = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'signcheck-')), 'unsigned.exe');
  fs.writeFileSync(destination, file);
  tempFiles.push(destination);
  return destination;
};

afterAll(() => {
  for (const file of tempFiles) {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

describe('readEmbeddedCertificate', () => {
  it('finds the certificate in a Microsoft-signed binary', () => {
    const result = readEmbeddedCertificate(SIGNED_PE);
    expect(result.signed).toBe(true);
    expect(result.certificate!.length).toBeGreaterThan(0);
  });

  it('reports a PE whose certificate table is empty as unsigned', () => {
    expect(readEmbeddedCertificate(makeUnsignedCopy(SIGNED_PE)).signed).toBe(false);
  });

  it('rejects a file that is not a PE at all', () => {
    expect(() => readEmbeddedCertificate(path.join(__dirname, 'customSign.js'))).toThrow(/not a PE file/);
  });
});

describe('verifyExpectedSigner', () => {
  it('accepts a binary signed by the expected signer', () => {
    expect(verifyExpectedSigner(SIGNED_PE, 'Microsoft Corporation')).toBeNull();
  });

  it('rejects a binary signed by somebody else', () => {
    // Guards the case that matters: a file lands under a path we claim is pre-signed, but the
    // signature is not the one we vouched for.
    expect(verifyExpectedSigner(SIGNED_PE, 'Definitely Not The Signer')).toMatch(/does not name/);
  });

  it('rejects an unsigned binary', () => {
    expect(verifyExpectedSigner(makeUnsignedCopy(SIGNED_PE), 'Microsoft Corporation')).toMatch(/no embedded signature/);
  });
});
