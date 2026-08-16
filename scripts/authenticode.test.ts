/* eslint-disable @typescript-eslint/no-require-imports */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';

const { readPeLayout, readEmbeddedCertificate, readSignedDigest, verifyExpectedSigner } =
  require('./authenticode.js') as {
    readPeLayout: (file: Buffer) => { certificateTableOffset: number; certificateTableSize: number };
    readEmbeddedCertificate: (filePath: string) => { signed: boolean; certificate?: Buffer };
    readSignedDigest: (certificate: Buffer) => { algorithm: string; digest: Buffer };
    verifyExpectedSigner: (filePath: string, expectedSigner: string) => string | null;
  };

/**
 * A real Microsoft-signed PE, shipped in node-pty's npm tarball on every platform, so this works
 * as a fixture on the Linux test runner too.
 *
 * The version directory is resolved rather than pinned: `EXEMPTIONS` in customSign.js does not pin
 * it either, so hardcoding it here would turn a routine node-pty bump into a mystery ENOENT.
 */
const CONPTY_DIR = path.join(__dirname, '..', 'node_modules', 'node-pty', 'third_party', 'conpty');
const SIGNED_PE = path.join(CONPTY_DIR, fs.readdirSync(CONPTY_DIR)[0]!, 'win10-x64', 'OpenConsole.exe');

const tempDirs: string[] = [];

const writeTemp = (name: string, contents: Buffer): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'authenticode-'));
  tempDirs.push(dir);
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, contents);
  return filePath;
};

/** Copy the fixture and flip a byte in its code, leaving the certificate table intact. */
const tamper = (): string => {
  const file = fs.readFileSync(SIGNED_PE);
  file[0x1000] ^= 0xff;
  return writeTemp('tampered.exe', file);
};

/** Copy the fixture and blank its IMAGE_DIRECTORY_ENTRY_SECURITY entry. */
const stripSignature = (): string => {
  const file = fs.readFileSync(SIGNED_PE);
  const peOffset = file.readUInt32LE(0x3c);
  const optionalHeaderOffset = peOffset + 24;
  const isPe32Plus = file.readUInt16LE(optionalHeaderOffset) === 0x20b;
  const securityDirectoryOffset = optionalHeaderOffset + (isPe32Plus ? 112 : 96) + 4 * 8;
  file.writeUInt32LE(0, securityDirectoryOffset);
  file.writeUInt32LE(0, securityDirectoryOffset + 4);
  return writeTemp('unsigned.exe', file);
};

/**
 * A minimal PE32 that declares fewer data directories than the security entry's index.
 *
 * The bytes where the security entry *would* live are deliberately non-zero (section headers, in a
 * real file). Without the NumberOfRvaAndSizes guard the parser reads them as an offset and size,
 * so this fixture distinguishes "guard present" from "guard removed" — with zeroes there, it would
 * pass either way and prove nothing.
 */
const buildPeWithFewDataDirectories = (): string => {
  const optionalHeaderSize = 96;
  const file = Buffer.alloc(0x40 + 4 + 20 + optionalHeaderSize + 64, 0xaa);
  file.fill(0, 0, 0x40 + 4 + 20 + optionalHeaderSize);
  file.writeUInt16LE(0x5a4d, 0); // MZ
  file.writeUInt32LE(0x40, 0x3c); // e_lfanew
  file.writeUInt32LE(0x00004550, 0x40); // PE\0\0
  file.writeUInt16LE(optionalHeaderSize, 0x40 + 20); // SizeOfOptionalHeader in the COFF header
  const optionalHeaderOffset = 0x40 + 24;
  file.writeUInt16LE(0x10b, optionalHeaderOffset); // PE32
  file.writeUInt32LE(2, optionalHeaderOffset + 92); // NumberOfRvaAndSizes: no security entry
  return writeTemp('few-dirs.exe', file);
};

/** Copy the fixture and rewrite a field of its WIN_CERTIFICATE header. */
const withCertificateHeader = (name: string, offset: number, value: number, width: 2 | 4): string => {
  const file = fs.readFileSync(SIGNED_PE);
  const peOffset = file.readUInt32LE(0x3c);
  const optionalHeaderOffset = peOffset + 24;
  const isPe32Plus = file.readUInt16LE(optionalHeaderOffset) === 0x20b;
  const securityDirectoryOffset = optionalHeaderOffset + (isPe32Plus ? 112 : 96) + 4 * 8;
  const tableOffset = file.readUInt32LE(securityDirectoryOffset);
  if (width === 2) {
    file.writeUInt16LE(value, tableOffset + offset);
  } else {
    file.writeUInt32LE(value, tableOffset + offset);
  }
  return writeTemp(name, file);
};

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('readEmbeddedCertificate', () => {
  it('finds the certificate in a Microsoft-signed binary', () => {
    const result = readEmbeddedCertificate(SIGNED_PE);
    expect(result.signed).toBe(true);
    expect(result.certificate!.length).toBeGreaterThan(0);
  });

  it('reports a PE whose certificate table is empty as unsigned', () => {
    expect(readEmbeddedCertificate(stripSignature()).signed).toBe(false);
  });

  it('reports a PE with fewer than five data directories as unsigned, not as a parse error', () => {
    // Without checking NumberOfRvaAndSizes we would read section headers as if they were the
    // security directory entry and report a misleading "certificate table runs past the end".
    const layout = readPeLayout(fs.readFileSync(buildPeWithFewDataDirectories()));
    expect(layout.certificateTableOffset).toBe(0);
    expect(layout.certificateTableSize).toBe(0);
    expect(readEmbeddedCertificate(buildPeWithFewDataDirectories()).signed).toBe(false);
  });

  it('rejects a file that is not a PE at all', () => {
    expect(() => readEmbeddedCertificate(path.join(__dirname, 'customSign.js'))).toThrow(/not a PE file/);
  });

  it.each([
    // The WIN_CERTIFICATE header sits inside the certificate table, which the Authenticode digest
    // does not cover — so these fields are free to tamper with unless they are checked. Windows
    // only honours WIN_CERT_TYPE_PKCS_SIGNED_DATA (0x0002) at revision 0x0200.
    ['a non-PKCS certificate type', 6, 0x0001, 2 as const, /unsupported certificate type/],
    ['an unknown certificate revision', 4, 0xffff, 2 as const, /unsupported certificate revision/],
    ['a length that overruns its table', 0, 0xffffff, 4 as const, /does not fit/],
    ['a length shorter than its own header', 0, 4, 4 as const, /does not fit/],
  ])('rejects %s', (name, offset, value, width, expected) => {
    expect(() =>
      readEmbeddedCertificate(withCertificateHeader(`${offset}-${value}.exe`, offset, value, width))
    ).toThrow(expected);
  });
});

describe('readDer', () => {
  it('rejects indefinite and oversized lengths rather than reading past the buffer', () => {
    // Indefinite length (0x80) is BER, not DER, and a >4-byte length would overflow the arithmetic.
    expect(() => readSignedDigest(Buffer.from([0x30, 0x80, 0x00, 0x00]))).toThrow(/unsupported DER length/);
    expect(() => readSignedDigest(Buffer.from([0x30, 0x85, 1, 2, 3, 4, 5]))).toThrow(/unsupported DER length/);
  });

  it('rejects a value that claims more bytes than the buffer holds', () => {
    expect(() => readSignedDigest(Buffer.from([0x30, 0x7f, 0x01, 0x02]))).toThrow(/past the end/);
  });
});

describe('readSignedDigest', () => {
  it('extracts the Authenticode digest and its algorithm', () => {
    const signed = readSignedDigest(readEmbeddedCertificate(SIGNED_PE).certificate!);
    expect(signed.algorithm).toBe('sha256');
    expect(signed.digest).toHaveLength(32);
  });
});

describe('verifyExpectedSigner', () => {
  it('accepts a binary signed by the expected signer', () => {
    expect(verifyExpectedSigner(SIGNED_PE, 'Microsoft Corporation')).toBeNull();
  });

  it('rejects a binary modified after signing', () => {
    // The check that matters: passing it is what authorises NOT signing the file ourselves, so a
    // certificate blob alone must not be enough — it has to still cover the file's contents.
    expect(verifyExpectedSigner(tamper(), 'Microsoft Corporation')).toMatch(/does not match the file contents/);
  });

  it('rejects an unsigned binary', () => {
    expect(verifyExpectedSigner(stripSignature(), 'Microsoft Corporation')).toMatch(/no embedded signature/);
  });

  it('rejects a binary whose certificate does not name the expected signer', () => {
    expect(verifyExpectedSigner(SIGNED_PE, 'Definitely Not The Signer')).toMatch(/does not name/);
  });
});
