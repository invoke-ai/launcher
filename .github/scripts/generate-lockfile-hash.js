#!/usr/bin/env node
/* eslint-disable  @typescript-eslint/no-require-imports */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const lockfilePath = path.join(process.cwd(), 'package-lock.json');
let lockfileContent = fs.readFileSync(lockfilePath, 'utf8');

// Remove the top-level version field (e.g., "version": "1.7.0-alpha.12",)
lockfileContent = lockfileContent.replace(/^\s*"version":\s*"[^"]+",?\n/m, '');

// Remove the version field in packages[""] (e.g., within "packages": { "": { "version": "1.7.0-alpha.12", ... } })
// This regex looks for the version field specifically within the empty string package entry
lockfileContent = lockfileContent.replace(/("packages"\s*:\s*\{\s*""\s*:\s*\{[^}]*?)"version":\s*"[^"]+",?\n/s, '$1');

// Generate SHA256 hash from the modified content
const hash = crypto.createHash('sha256').update(lockfileContent).digest('hex');

// Output just the hash for use in GitHub Actions
console.log(hash);
