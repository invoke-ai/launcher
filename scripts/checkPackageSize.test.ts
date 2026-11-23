import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkPackageSize } from './checkPackageSize.js';

describe('installer size budget', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'launcher-size-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const add = (name: string, size: number) => {
    const file = join(dir, name);
    writeFileSync(file, '');
    truncateSync(file, size);
  };
  it('checks both macOS formats and ignores latest aliases and blockmaps', () => {
    add('Launcher-1.2.3.dmg', 1);
    add('Launcher-1.2.3-mac.zip', 1);
    add('Launcher-latest-mac.zip', 0);
    add('Launcher-1.2.3.dmg.blockmap', 0);
    expect(() => checkPackageSize(dir, 'darwin-arm64', '1.2.3')).not.toThrow();
  });
  it('requires a versioned installer even when a latest alias exists', () => {
    add('Launcher-latest.AppImage', 1);
    expect(() => checkPackageSize(dir, 'linux-x64', '1.2.3')).toThrow(/found 0/);
  });
  it.each([
    ['win32-x64', 0],
    ['win32-arm64', 140000000],
  ] as const)('rejects invalid installer size on %s', (target, size) => {
    add('Launcher-1.2.3.exe', size);
    expect(() => checkPackageSize(dir, target, '1.2.3')).toThrow(/Unexpected download size/);
  });
});
