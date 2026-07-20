import { IpcEmitter, IpcListener } from '@electron-toolkit/typed-ipc/main';
import { app, BrowserWindow, dialog, Menu, nativeImage, shell, Tray } from 'electron';
import contextMenu from 'electron-context-menu';
import type Store from 'electron-store';
import path from 'path';

import { isDevelopment, manageWindowSize } from '@/main/util';
import type {
  InvokeProcessStatus,
  IpcEvents,
  IpcRendererEvents,
  MainProcessStatus,
  StoreData,
  WithTimestamp,
} from '@/shared/types';

// electron-vite resolves this to the icon's runtime path, copying the file into the build output.
import trayIconPath from '../../assets/images/invoke-avatar-square.png?asset';
import { checkForUpdates } from './updater';

const NOT_INITIALIZED_MESSAGE = 'Main window is not initialized';

export class MainProcessManager {
  private window: BrowserWindow | null;
  private status: WithTimestamp<MainProcessStatus>;
  private store: Store<StoreData>;
  /** The system tray icon, present only while the launcher is hidden to the tray. */
  private tray: Tray | null;
  /** Whether the launcher window is currently hidden to the system tray. */
  private isHiddenToTray: boolean;
  /** Whether the application is in the process of quitting. Used to skip the close-confirmation dialog. */
  private isQuitting: boolean;
  /** The last known Invoke process status type. Used to decide whether to confirm closing the launcher. */
  private invokeStatusType: InvokeProcessStatus['type'] | null;

  ipc: IpcListener<IpcEvents>;
  emitter: IpcEmitter<IpcRendererEvents>;

  constructor(arg: { store: Store<StoreData> }) {
    const { store } = arg;
    this.window = null;
    this.ipc = new IpcListener<IpcEvents>();
    this.emitter = new IpcEmitter<IpcRendererEvents>();
    this.status = { type: 'initializing', timestamp: Date.now() };
    this.store = store;
    this.tray = null;
    this.isHiddenToTray = false;
    this.isQuitting = false;
    this.invokeStatusType = null;

    app.on('before-quit', () => {
      this.isQuitting = true;
    });
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
    this.ipc.handle('main-process:hide-to-tray', () => {
      this.hideToTray();
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
      useContentSize: true,
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
      checkForUpdates(window);
    });

    // If the user closes the launcher window while Invoke is still running, confirm first. Closing the launcher hides
    // access to the logs and controls, which is easy to do by accident.
    window.on('close', (event) => {
      if (this.isQuitting || this.isHiddenToTray) {
        return;
      }
      const isInvokeActive =
        this.invokeStatusType === 'running' ||
        this.invokeStatusType === 'starting' ||
        this.invokeStatusType === 'window-crashed';
      if (!isInvokeActive) {
        return;
      }
      const choice = dialog.showMessageBoxSync(window, {
        type: 'question',
        buttons: ['Cancel', 'Close Launcher'],
        defaultId: 0,
        cancelId: 0,
        title: 'Close Launcher?',
        message: 'Invoke is still running.',
        detail:
          'Closing the launcher hides access to the logs and controls. Invoke itself will keep running. Are you sure you want to close the launcher?',
      });
      if (choice === 0) {
        event.preventDefault();
      }
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

  /**
   * React to Invoke process status changes to drive the tray behavior.
   * - When Invoke starts successfully, hide the launcher to the tray (if enabled and not in server mode).
   * - When Invoke shuts down normally while hidden, quit the launcher entirely.
   * - When Invoke errors or its window crashes while hidden, restore the launcher so the user can see what happened.
   */
  handleInvokeStatusChange = (status: WithTimestamp<InvokeProcessStatus>): void => {
    this.invokeStatusType = status.type;

    switch (status.type) {
      case 'running': {
        // Hide once Invoke is up. This applies in server mode too - the tray icon is exactly the point there, since the
        // launcher is the only window and the user wants it out of the way while the server runs in the background.
        if (this.store.get('hideLauncherAfterStartup')) {
          this.hideToTray();
        }
        break;
      }
      case 'exited': {
        // Invoke shut down normally. If the launcher was hidden to the tray, the user is done - quit entirely.
        if (this.isHiddenToTray) {
          app.quit();
        }
        break;
      }
      case 'error':
      case 'window-crashed': {
        // Something went wrong - bring the launcher back so the user can read the logs and recover.
        if (this.isHiddenToTray) {
          this.showFromTray();
        }
        break;
      }
      default:
        break;
    }
  };

  /**
   * Hide the launcher window to the system tray, creating the tray icon if necessary.
   */
  hideToTray = (): void => {
    if (!this.window || this.window.isDestroyed() || this.isHiddenToTray) {
      return;
    }
    this.createTray();
    this.window.hide();
    this.isHiddenToTray = true;
  };

  /**
   * Restore the launcher window from the system tray and remove the tray icon.
   */
  showFromTray = (): void => {
    this.isHiddenToTray = false;
    this.destroyTray();
    if (!this.window || this.window.isDestroyed()) {
      return;
    }
    this.window.show();
    this.window.focus();
  };

  private createTray = (): void => {
    if (this.tray) {
      return;
    }
    const image = nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 });
    const tray = new Tray(image.isEmpty() ? trayIconPath : image);
    tray.setToolTip('Invoke Community Edition');
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Show Launcher', click: this.showFromTray },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]);
    tray.setContextMenu(contextMenu);
    // Restoring on click is the expected behavior on Windows/Linux; harmless on macOS where the menu opens on click.
    tray.on('click', this.showFromTray);
    tray.on('double-click', this.showFromTray);
    this.tray = tray;
  };

  private destroyTray = (): void => {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  };

  cleanup = () => {
    this.destroyTray();
    this.closeWindow();
  };
}
