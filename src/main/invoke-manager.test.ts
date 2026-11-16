import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  BrowserWindow: vi.fn(),
  buildMenu: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: mocks.BrowserWindow,
  Menu: { buildFromTemplate: mocks.buildMenu },
}));
vi.mock('@/lib/command-runner', () => ({ CommandRunner: class {} }));
vi.mock('@/lib/pty-utils', () => ({ DEFAULT_ENV: {} }));
vi.mock('@/main/util', () => ({ manageWindowSize: vi.fn() }));

import { InvokeManager } from '@/main/invoke-manager';

describe('image viewer window menu', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    vi.resetAllMocks();
  });

  const openViewer = (platform: NodeJS.Platform) => {
    Object.defineProperty(process, 'platform', { value: platform });
    const webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: vi.fn(),
      loadURL: vi.fn(),
    });
    const mainWindow = Object.assign(new EventEmitter(), { webContents, setMenu: vi.fn() });
    mocks.BrowserWindow.mockReturnValue(mainWindow);
    const invoke = new InvokeManager({
      store: { get: vi.fn() } as unknown as ConstructorParameters<typeof InvokeManager>[0]['store'],
      ipcLogger: vi.fn(),
      ipcRawOutput: vi.fn(),
      onStatusChange: vi.fn(),
    });

    invoke.createWindow('http://127.0.0.1:9090');
    const viewer = { setMenu: vi.fn() };
    webContents.emit('did-create-window', viewer);
    return { mainWindow, viewer };
  };

  it.each(['win32', 'linux'] as const)('uses a window close action in the File menu on %s', (platform) => {
    const menu = {};
    mocks.buildMenu.mockReturnValue(menu);

    const { mainWindow, viewer } = openViewer(platform);

    expect(mocks.buildMenu).toHaveBeenCalledWith(
      expect.arrayContaining([{ role: 'fileMenu', submenu: [{ role: 'close' }] }])
    );
    expect(viewer.setMenu).toHaveBeenCalledWith(menu);
    expect(mainWindow.setMenu).not.toHaveBeenCalled();
  });

  it('uses the native application menu on macOS', () => {
    const { viewer } = openViewer('darwin');

    expect(viewer.setMenu).not.toHaveBeenCalled();
  });
});
