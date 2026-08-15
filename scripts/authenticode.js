/* eslint-disable  @typescript-eslint/no-require-imports */

const crypto = require('crypto');
const fs = require('fs');

/**
 * Just enough Authenticode to answer one question: does this PE carry a signature that actually
 * covers its current contents, made by who we think?
 *
 * We use this to decide whether to leave a third-party binary's signature alone instead of
 * replacing it with ours. A substring search for "Microsoft Corporation" over the PKCS#7 blob is
 * not good enough for that: the blob carries the whole chain plus the timestamp countersignature,
 * so an issuer or timestamping authority name satisfies it, and — more importantly — it says
 * nothing about whether the signature still matches the file. A binary modified after signing, or
 * one carrying a certificate table grafted from another file, would sail through.
 *
 * So we recompute the Authenticode digest over the PE and compare it against the digest the
 * signature commits to.
 *
 * Two things this deliberately does NOT do, both out of scope for what it is guarding:
 *
 * - It does not validate the trust chain (is the CA trusted, is the certificate revoked, was it
 *   valid at signing time). That is Windows' job, and getting it wrong in CI would produce
 *   confident nonsense.
 * - It does not verify the RSA signature over the digest, so a hand-crafted PKCS#7 carrying the
 *   right digest and the right name would pass.
 *
 * Neither weakens the guarantee we actually want. The threat here is *drift*, not an adversary: a
 * dependency bump swapping in an unsigned binary, or a file changing after somebody added an
 * exemption for it. Anyone able to plant a forged blob in node_modules could equally well edit the
 * exemption list in customSign.js, so defending against that here would buy nothing.
 */

const SPC_INDIRECT_DATA_OID = '1.3.6.1.4.1.311.2.1.4';
const SIGNED_DATA_OID = '1.2.840.113549.1.7.2';

const DIGEST_ALGORITHM_OIDS = {
  '1.3.14.3.2.26': 'sha1',
  '2.16.840.1.101.3.4.2.1': 'sha256',
  '2.16.840.1.101.3.4.2.2': 'sha384',
  '2.16.840.1.101.3.4.2.3': 'sha512',
};

/**
 * @typedef {object} DerNode
 * @property {number} tag
 * @property {Buffer} content the value bytes
 * @property {number} end offset just past this node in its parent buffer
 */

/**
 * Read one DER TLV at `offset`.
 *
 * @param {Buffer} buffer
 * @param {number} offset
 * @returns {DerNode}
 */
function readDer(buffer, offset) {
  if (offset + 2 > buffer.length) {
    throw new Error('truncated DER');
  }
  const tag = buffer[offset];
  let cursor = offset + 1;
  let length = buffer[cursor++];

  if (length & 0x80) {
    const lengthBytes = length & 0x7f;
    if (lengthBytes === 0 || lengthBytes > 4 || cursor + lengthBytes > buffer.length) {
      throw new Error('unsupported DER length');
    }
    length = 0;
    for (let i = 0; i < lengthBytes; i++) {
      length = length * 256 + buffer[cursor++];
    }
  }
  if (cursor + length > buffer.length) {
    throw new Error('DER value runs past the end of the buffer');
  }
  return { tag, content: buffer.subarray(cursor, cursor + length), end: cursor + length };
}

/**
 * Read the sequence of DER nodes making up `buffer`.
 *
 * @param {Buffer} buffer
 * @returns {DerNode[]}
 */
function readDerSequence(buffer) {
  const nodes = [];
  let offset = 0;
  while (offset < buffer.length) {
    const node = readDer(buffer, offset);
    nodes.push(node);
    offset = node.end;
  }
  return nodes;
}

/**
 * Decode a DER OBJECT IDENTIFIER's value bytes into dotted form.
 *
 * @param {Buffer} content
 * @returns {string}
 */
function decodeOid(content) {
  if (content.length === 0) {
    return '';
  }
  const parts = [Math.floor(content[0] / 40), content[0] % 40];
  let value = 0;
  for (let i = 1; i < content.length; i++) {
    value = value * 128 + (content[i] & 0x7f);
    if ((content[i] & 0x80) === 0) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join('.');
}

/**
 * Locate a PE's optional-header landmarks and its attribute certificate table.
 *
 * @param {Buffer} file
 * @returns {{ checksumOffset: number, securityDirectoryOffset: number, certificateTableOffset: number, certificateTableSize: number }}
 */
function readPeLayout(file) {
  if (file.length < 0x40 || file.readUInt16LE(0) !== 0x5a4d /* MZ */) {
    throw new Error('not a PE file (missing MZ header)');
  }
  const peOffset = file.readUInt32LE(0x3c);
  if (file.length < peOffset + 24 || file.readUInt32LE(peOffset) !== 0x00004550 /* PE\0\0 */) {
    throw new Error('not a PE file (missing PE signature)');
  }

  const optionalHeaderOffset = peOffset + 24;
  const optionalHeaderSize = file.readUInt16LE(peOffset + 20);
  if (optionalHeaderSize === 0) {
    throw new Error('object file has no optional header');
  }

  const magic = file.readUInt16LE(optionalHeaderOffset);
  if (magic !== 0x10b && magic !== 0x20b) {
    throw new Error(`unrecognised optional header magic 0x${magic.toString(16)}`);
  }
  // PE32 keeps the data directories 96 bytes in; PE32+ drops BaseOfData and adds four 8-byte
  // fields, putting them at 112.
  const isPe32Plus = magic === 0x20b;
  const numberOfRvaAndSizesOffset = optionalHeaderOffset + (isPe32Plus ? 108 : 92);
  const dataDirectoryOffset = optionalHeaderOffset + (isPe32Plus ? 112 : 96);

  if (numberOfRvaAndSizesOffset + 4 > file.length) {
    throw new Error('truncated PE optional header');
  }
  // Data directory 4 is IMAGE_DIRECTORY_ENTRY_SECURITY. A PE is free to declare fewer entries than
  // that, in which case section headers live where we would otherwise read — so check first rather
  // than reading unrelated bytes and reporting a bogus certificate table.
  const numberOfRvaAndSizes = file.readUInt32LE(numberOfRvaAndSizesOffset);
  const layout = {
    checksumOffset: optionalHeaderOffset + 64,
    securityDirectoryOffset: dataDirectoryOffset + 4 * 8,
    certificateTableOffset: 0,
    certificateTableSize: 0,
  };
  if (numberOfRvaAndSizes < 5) {
    return layout;
  }
  if (layout.securityDirectoryOffset + 8 > file.length) {
    throw new Error('truncated PE data directory');
  }
  layout.certificateTableOffset = file.readUInt32LE(layout.securityDirectoryOffset);
  // Unlike every other data directory entry, this one holds a plain file offset, not an RVA.
  layout.certificateTableSize = file.readUInt32LE(layout.securityDirectoryOffset + 4);
  return layout;
}

/**
 * Read a PE's embedded PKCS#7 signature blob.
 *
 * @param {string} filePath
 * @returns {{ signed: false } | { signed: true, certificate: Buffer }}
 */
function readEmbeddedCertificate(filePath) {
  const file = fs.readFileSync(filePath);
  const layout = readPeLayout(file);

  if (layout.certificateTableSize === 0 || layout.certificateTableOffset === 0) {
    return { signed: false };
  }
  if (layout.certificateTableSize < 8 || layout.certificateTableOffset + layout.certificateTableSize > file.length) {
    throw new Error('certificate table runs past the end of the file');
  }

  // WIN_CERTIFICATE: dwLength (4), wRevision (2), wCertificateType (2), then the blob. These bytes
  // sit inside the certificate table, which the Authenticode digest does not cover — so they are
  // free to tamper with unless we check them. Windows only treats WIN_CERT_TYPE_PKCS_SIGNED_DATA
  // as an Authenticode signature; anything else is not a signature we may defer to.
  const length = file.readUInt32LE(layout.certificateTableOffset);
  const revision = file.readUInt16LE(layout.certificateTableOffset + 4);
  const certificateType = file.readUInt16LE(layout.certificateTableOffset + 6);
  if (certificateType !== 0x0002 /* WIN_CERT_TYPE_PKCS_SIGNED_DATA */) {
    throw new Error(`unsupported certificate type 0x${certificateType.toString(16).padStart(4, '0')}`);
  }
  if (revision !== 0x0200 /* WIN_CERT_REVISION_2_0 */) {
    throw new Error(`unsupported certificate revision 0x${revision.toString(16).padStart(4, '0')}`);
  }
  if (length < 8 || length > layout.certificateTableSize) {
    throw new Error(`WIN_CERTIFICATE length ${length} does not fit its ${layout.certificateTableSize}-byte table`);
  }
  return {
    signed: true,
    certificate: file.subarray(layout.certificateTableOffset + 8, layout.certificateTableOffset + length),
  };
}

/**
 * Describe the signature a PE already carries.
 *
 * `intact` means the file holds a signature whose digest still covers its current contents — the
 * condition under which we must not sign over it. `broken` means there is a certificate table but
 * it does not describe this file, which Windows treats as unsigned, so signing it ourselves is an
 * improvement rather than a loss.
 *
 * @param {string} filePath
 * @returns {{ state: 'unsigned' } | { state: 'intact', certificate: Buffer } | { state: 'broken', reason: string }}
 */
function inspectSignature(filePath) {
  let file;
  let layout;
  let embedded;
  try {
    file = fs.readFileSync(filePath);
    layout = readPeLayout(file);
    embedded = readEmbeddedCertificate(filePath);
  } catch (error) {
    return { state: 'broken', reason: `its certificate table could not be read (${error.message})` };
  }
  if (!embedded.signed) {
    return { state: 'unsigned' };
  }

  let signed;
  try {
    signed = readSignedDigest(embedded.certificate);
  } catch (error) {
    return { state: 'broken', reason: `its signature could not be parsed (${error.message})` };
  }

  const actual = computeAuthenticodeDigest(file, layout, signed.algorithm);
  if (!actual.equals(signed.digest)) {
    return {
      state: 'broken',
      reason:
        `its signature does not match the file contents (${signed.algorithm}: signed ` +
        `${signed.digest.toString('hex').slice(0, 16)}…, actual ${actual.toString('hex').slice(0, 16)}…) — ` +
        'the binary was modified after signing, or the certificate table came from another file',
    };
  }
  return { state: 'intact', certificate: embedded.certificate };
}

/**
 * Compute the Authenticode digest of a PE: the whole file except the three regions a signature
 * cannot cover — the checksum field, the security data directory entry, and the certificate table
 * itself.
 *
 * @param {Buffer} file
 * @param {ReturnType<typeof readPeLayout>} layout
 * @param {string} algorithm a Node digest name, e.g. 'sha256'
 * @returns {Buffer}
 */
function computeAuthenticodeDigest(file, layout, algorithm) {
  const hash = crypto.createHash(algorithm);
  hash.update(file.subarray(0, layout.checksumOffset));
  hash.update(file.subarray(layout.checksumOffset + 4, layout.securityDirectoryOffset));

  if (layout.certificateTableOffset === 0) {
    hash.update(file.subarray(layout.securityDirectoryOffset + 8));
    return hash.digest();
  }
  hash.update(file.subarray(layout.securityDirectoryOffset + 8, layout.certificateTableOffset));
  // Anything appended after the certificate table is part of the signed content.
  const trailingOffset = layout.certificateTableOffset + layout.certificateTableSize;
  if (trailingOffset < file.length) {
    hash.update(file.subarray(trailingOffset));
  }
  return hash.digest();
}

/**
 * Pull the digest the signature commits to out of the PKCS#7 blob.
 *
 * ContentInfo -> [0] SignedData -> encapContentInfo -> [0] OCTET STRING -> SpcIndirectDataContent,
 * whose second element is a DigestInfo of { AlgorithmIdentifier, OCTET STRING digest }.
 *
 * @param {Buffer} certificate
 * @returns {{ algorithm: string, digest: Buffer }}
 */
function readSignedDigest(certificate) {
  const contentInfo = readDer(certificate, 0);
  const contentInfoFields = readDerSequence(contentInfo.content);
  if (decodeOid(contentInfoFields[0].content) !== SIGNED_DATA_OID) {
    throw new Error('PKCS#7 blob is not signedData');
  }

  const signedData = readDer(contentInfoFields[1].content, 0);
  const signedDataFields = readDerSequence(signedData.content);
  // version, digestAlgorithms, encapContentInfo, ...
  const encapContentInfoFields = readDerSequence(signedDataFields[2].content);
  if (decodeOid(encapContentInfoFields[0].content) !== SPC_INDIRECT_DATA_OID) {
    throw new Error('signature does not carry Authenticode indirect data');
  }

  // Authenticode puts SpcIndirectDataContent straight inside the [0] EXPLICIT wrapper, where
  // standard CMS would wrap it in an OCTET STRING first. Accept either.
  let spcIndirectData = readDer(encapContentInfoFields[1].content, 0);
  if (spcIndirectData.tag === 0x04 /* OCTET STRING */) {
    spcIndirectData = readDer(spcIndirectData.content, 0);
  }
  const spcFields = readDerSequence(spcIndirectData.content);
  const digestInfoFields = readDerSequence(spcFields[1].content);
  const algorithmOid = decodeOid(readDerSequence(digestInfoFields[0].content)[0].content);
  const algorithm = DIGEST_ALGORITHM_OIDS[algorithmOid];
  if (!algorithm) {
    throw new Error(`unsupported digest algorithm ${algorithmOid}`);
  }
  return { algorithm, digest: digestInfoFields[1].content };
}

/**
 * Check that `filePath` carries a signature that covers its current contents and names
 * `expectedSigner`.
 *
 * The digest comparison is the load-bearing part — it is what distinguishes a genuinely signed
 * binary from one that merely has a certificate blob stapled to it. The name check is a weaker
 * sanity check: the blob holds the whole chain, so a match may be against an issuer or the
 * timestamping authority rather than the signer itself.
 *
 * @param {string} filePath
 * @param {string} expectedSigner
 * @returns {string | null} a description of the problem, or null if the signature checks out
 */
function verifyExpectedSigner(filePath, expectedSigner) {
  const signature = inspectSignature(filePath);
  if (signature.state === 'unsigned') {
    return 'it carries no embedded signature at all';
  }
  if (signature.state === 'broken') {
    return signature.reason;
  }
  if (!signature.certificate.includes(Buffer.from(expectedSigner, 'latin1'))) {
    return `its certificate does not name "${expectedSigner}"`;
  }
  return null;
}

module.exports = {
  readPeLayout,
  readEmbeddedCertificate,
  computeAuthenticodeDigest,
  readSignedDigest,
  inspectSignature,
  verifyExpectedSigner,
};
