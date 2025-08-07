import { IpcEmitter, IpcListener } from '@electron-toolkit/typed-ipc/main';
import { app, BrowserWindow, shell } from 'electron';
import contextMenu from 'electron-context-menu';
import type Store from 'electron-store';
import path from 'path';

import { isDevelopment, manageWindowSize } from '@/main/util';
import type { IpcEvents, IpcRendererEvents, MainProcessStatus, StoreData, WithTimestamp } from '@/shared/types';

const NOT_INITIALIZED_MESSAGE = 'Main window is not initialized';

export class MainProcessManager {
  private window: BrowserWindow | null;
  private status: WithTimestamp<MainProcessStatus>;
  private store: Store<StoreData>;

  ipc: IpcListener<IpcEvents>;
  emitter: IpcEmitter<IpcRendererEvents>;

  constructor(arg: { store: Store<StoreData> }) {
    const { store } = arg;
    this.window = null;
    this.ipc = new IpcListener<IpcEvents>();
    this.emitter = new IpcEmitter<IpcRendererEvents>();
    this.status = { type: 'initializing', timestamp: Date.now() };
    this.store = store;
    this.store.onDidAnyChange((data) => {
      this.sendToWindow('store:changed', data);
    });
    this.ipc.handle('store:get-key', (_, key) => this.store.get(key));
    this.ipc.handle('store:set-key', (_, key, value) => this.store.set(key, value));
    this.ipc.handle('store:get', (_) => this.store.store);
    this.ipc.handle('store:set', (_, data) => {
      this.store.store = data;
    });
    this.ipc.handle('store:reset', (_) => {
      this.store.clear();
    });

    contextMenu({
      showSaveImageAs: true,
      showSearchWithGoogle: false,
      showInspectElement: false,
      showLookUpSelection: false,
    });
  }

  getStatus = (): WithTimestamp<MainProcessStatus> => {
    return this.status;
  };

  updateStatus = (status: MainProcessStatus): void => {
    this.status = { ...status, timestamp: Date.now() };
    this.sendToWindow('main-process:status', this.status);
  };

  sendToWindow = <T extends keyof IpcRendererEvents>(channel: T, ...args: IpcRendererEvents[T]) => {
    if (!this.window) {
      console.warn(NOT_INITIALIZED_MESSAGE);
      return;
    }

    if (this.window.isDestroyed()) {
      return;
    }

    this.emitter.send(this.window.webContents, channel as Extract<T, string>, ...args);
  };

  createWindow = () => {
    const window = new BrowserWindow({
      minWidth: 800,
      minHeight: 600,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        nodeIntegration: true,
        contextIsolation: true,
        devTools: true,
      },
      autoHideMenuBar: true, // Hide the menu bar
      frame: true, // Keep window frame/chrome
      icon: path.join(__dirname, 'assets/icons/icon.png'),
      backgroundColor: 'hsl(220, 12%, 10%)', // base.900
      show: false,
    });

    const winProps = this.store.get('launcherWindowProps');
    manageWindowSize(window, winProps, (windowProps) => {
      this.store.set('launcherWindowProps', windowProps);
    });

    // Open external links in the default browser
    window.webContents.setWindowOpenHandler((edata) => {
      shell.openExternal(edata.url);
      return { action: 'deny' };
    });

    window.once('ready-to-show', () => {
      this.updateStatus({ type: 'idle' });
      window.show();
    });

    // Disable a few things in production
    if (!isDevelopment()) {
      // Prevent navigation and page reload
      window.webContents.on('will-navigate', (event) => {
        event.preventDefault();
      });

      // Prevent Ctrl/Cmd+R and F5, which would reload the page
      window.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'r' && (input.control || input.meta) && !input.alt) {
          event.preventDefault();
        }
        if (input.key === 'F5') {
          event.preventDefault();
        }
      });
    }

    this.window = window;

    // Load the window based on whether we're in development or production
    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
      // Development: load from Vite dev server
      window.loadURL(process.env['ELECTRON_RENDERER_URL']);
    } else {
      // Production: load from local file
      window.loadFile(path.join(__dirname, '../renderer/index.html'));
    }
  };

  loadURL = (url: string) => {
    if (!this.window) {
      console.warn(NOT_INITIALIZED_MESSAGE);
      return;
    }
    return this.window.loadURL(url);
  };

  loadFile = (file: string) => {
    if (!this.window) {
      console.warn(NOT_INITIALIZED_MESSAGE);
      return;
    }
    return this.window.loadFile(file);
  };

  getWindow = (): BrowserWindow | null => {
    return this.window;
  };

  closeWindow = (): void => {
    if (!this.window) {
      return;
    }
    if (!this.window.isDestroyed()) {
      this.window.close();
    }
    this.window = null;
  };

  cleanup = () => {
    this.closeWindow();
  };
}
