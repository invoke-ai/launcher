import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { classifyBinary, SIGN_PATTERNS } = require('./customSign.js') as {
  classifyBinary: (filePath: string) => string;
  SIGN_PATTERNS: RegExp[];
};

/**
 * These paths are the real ones electron-builder hands to the signing hook, taken from CI logs and
 * from a `dist/win-unpacked` tree. The winpty-agent.exe case is the literal path from
 * https://github.com/invoke-ai/launcher/issues/148 — Smart App Control blocked it because we were
 * shipping it unsigned.
 */
const UNPACKED = 'D:\\a\\launcher\\launcher\\dist\\win-unpacked';
const NODE_PTY = `${UNPACKED}\\resources\\app.asar.unpacked\\node_modules\\node-pty`;

describe('classifyBinary', () => {
  it.each([
    // Our own artifacts.
    ['D:\\a\\launcher\\launcher\\dist\\Invoke Community Edition Setup 1.8.2.exe'],
    ['D:\\a\\launcher\\launcher\\dist\\__uninstaller-nsis-invoke-community-edition.exe'],
    [`${UNPACKED}\\Invoke Community Edition.exe`],
    // node-pty's own build output. winpty-agent.exe is issue #148.
    [`${NODE_PTY}\\build\\Release\\winpty-agent.exe`],
    [`${NODE_PTY}\\build\\Release\\winpty.dll`],
    [`${NODE_PTY}\\build\\Release\\pty.node`],
    [`${NODE_PTY}\\build\\Release\\conpty.node`],
    [`${NODE_PTY}\\build\\Release\\conpty_console_list.node`],
    [`${NODE_PTY}\\bin\\win32-x64-136\\node-pty.node`],
    // uv, bundled via extraResources and spawned as a child process.
    [`${UNPACKED}\\resources\\bin\\uv.exe`],
    // electron-builder's NSIS elevation helper: unsigned upstream, and electron-updater spawns it
    // from process.resourcesPath when an update needs admin rights.
    [`${UNPACKED}\\resources\\elevate.exe`],
  ])('signs %s', (filePath) => {
    expect(classifyBinary(filePath)).toBe('sign');
  });

  it.each([
    // Microsoft's ConPTY binaries, redistributed verbatim by node-pty and already signed by them.
    // The `third_party` copies are what ships in the npm tarball...
    [`${NODE_PTY}\\third_party\\conpty\\1.20.240626001\\win10-x64\\OpenConsole.exe`],
    [`${NODE_PTY}\\third_party\\conpty\\1.20.240626001\\win10-x64\\conpty.dll`],
    [`${NODE_PTY}\\third_party\\conpty\\1.20.240626001\\win10-arm64\\OpenConsole.exe`],
    // ...and node-pty's scripts/post-install.js copies the current arch's pair here on Windows,
    // inside the build output directory that the node-pty signing rule otherwise claims.
    [`${NODE_PTY}\\build\\Release\\conpty\\OpenConsole.exe`],
    [`${NODE_PTY}\\build\\Release\\conpty\\conpty.dll`],
  ])('leaves the upstream signature on %s', (filePath) => {
    expect(classifyBinary(filePath)).toBe('skip-already-signed');
  });

  it.each([
    [`${UNPACKED}\\ffmpeg.dll`],
    [`${UNPACKED}\\libEGL.dll`],
    [`${UNPACKED}\\libGLESv2.dll`],
    [`${UNPACKED}\\vk_swiftshader.dll`],
    [`${UNPACKED}\\vulkan-1.dll`],
    [`${UNPACKED}\\d3dcompiler_47.dll`],
  ])('skips the Electron runtime DLL %s', (filePath) => {
    expect(classifyBinary(filePath)).toBe('skip-out-of-scope');
  });

  it.each([[`${UNPACKED}\\resources\\some-new-tool.exe`], [`${NODE_PTY}\\deps\\winpty\\ship\\stray.exe`]])(
    'reports %s as unknown so CI fails on it',
    (filePath) => {
      expect(classifyBinary(filePath)).toBe('unknown');
    }
  );

  it('accepts forward slashes as well as backslashes', () => {
    expect(
      classifyBinary(
        '/home/runner/dist/win-unpacked/resources/app.asar.unpacked/node_modules/node-pty/build/Release/winpty-agent.exe'
      )
    ).toBe('sign');
  });

  it('does not sign unrelated executables just because they sit under a product-named directory', () => {
    expect(classifyBinary('C:\\Program Files\\Invoke Community Edition\\vendor\\thirdparty.exe')).toBe('unknown');
  });

  it('prefers the upstream-signature rule over the node-pty signing rule', () => {
    // `build/Release/conpty/` is matched by BOTH the node-pty signing rule (which recurses into
    // build output on purpose) and the upstream-signature rule. The upstream rule has to win, or
    // we would strip Microsoft's signature off OpenConsole.exe and replace it with ours. Swapping
    // the two checks in classifyBinary() must fail this test.
    const conptyDll = `${NODE_PTY}\\build\\Release\\conpty\\conpty.dll`;
    expect(classifyBinary(conptyDll)).toBe('skip-already-signed');
    expect(SIGN_PATTERNS.some((pattern) => pattern.test(conptyDll.replace(/\\/g, '/')))).toBe(true);
  });
});
