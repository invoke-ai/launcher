import { IpcEmitter, IpcListener } from '@electron-toolkit/typed-ipc/main';
import { app, BrowserWindow, dialog, Menu, nativeImage, shell, Tray } from 'electron';
import contextMenu from 'electron-context-menu';
import type Store from 'electron-store';
import path from 'path';

import { isDevelopment, manageWindowSize } from '@/main/util';
import type {
  InstallProcessStatus,
  InvokeProcessStatus,
  IpcEvents,
  IpcRendererEvents,
  MainProcessStatus,
  StoreData,
  WithTimestamp,
} from '@/shared/types';

// electron-vite resolves this to the icon's runtime path, copying the file into the build output. We use the RGBA app
// icon (with a real alpha channel) rather than the opaque avatar square so it reads correctly on a menu bar.
import trayIconPath from '../../build/icon.png?asset';
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
  /**
   * Whether the launcher was hidden automatically after Invoke started (as opposed to a manual "minimize to tray").
   * Only an auto-hide arms the "quit when Invoke shuts down normally" behavior - a manual minimize keeps the app
   * running in the tray.
   */
  private autoHiddenAfterStartup: boolean;
  /** Whether the application is in the process of quitting. Used to skip the close-confirmation dialog. */
  private isQuitting: boolean;
  /** The last known Invoke process status type. Used to decide tray behavior and whether to confirm closing. */
  private invokeStatusType: InvokeProcessStatus['type'] | null;
  /** The last known install process status type. Used to decide whether to confirm closing and to restore on finish. */
  private installStatusType: InstallProcessStatus['type'] | null;
  /** Whether tray creation has already failed once (some platforms have no tray host). Avoids re-throwing every call. */
  private trayCreationFailed: boolean;
  /** Guards the one-time update check so recreating the launcher window does not re-prompt. */
  private hasCheckedForUpdates: boolean;
  /**
   * Source of truth for whether Invoke currently has its own window. Injected from the Invoke manager (see
   * {@link setInvokeWindowChecker}) so the close-confirmation reflects reality rather than re-reading `serverMode`,
   * which the user can toggle mid-session.
   */
  private invokeHasWindow: () => boolean;

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
    this.autoHiddenAfterStartup = false;
    this.isQuitting = false;
    this.invokeStatusType = null;
    this.installStatusType = null;
    this.trayCreationFailed = false;
    this.hasCheckedForUpdates = false;
    this.invokeHasWindow = () => false;

    app.on('before-quit', () => {
      this.isQuitting = true;
    });

    // On macOS, clicking the Dock icon should bring the launcher back, whether it is hidden to the tray or just closed
    // to the background. This is also the recovery route if the tray icon failed to render.
    app.on('activate', () => {
      this.focusOrRestore();
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
    // Never build a window in a process that doesn't hold the single-instance lock. A non-primary instance is on its way
    // to quitting, and the activate/second-instance paths can reach this before that bail-out completes.
    if (!app.hasSingleInstanceLock()) {
      return;
    }

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
      // Only check for updates once per app run, not every time the launcher window is (re)created on a recovery path.
      if (!this.hasCheckedForUpdates) {
        this.hasCheckedForUpdates = true;
        checkForUpdates(window);
      }
    });

    // Null out our reference when the window is actually destroyed, so recovery paths know to recreate it rather than
    // poking a dead window. Without this, closing the launcher in desktop mode (Invoke keeps the app alive) would leave
    // every restore route a no-op.
    window.on('closed', () => {
      if (this.window === window) {
        this.window = null;
      }
    });

    // If the user closes the launcher window while work is in progress, confirm first - and tell them what will
    // actually happen, which depends on whether closing the launcher would take Invoke/the install down with it.
    window.on('close', (event) => {
      if (this.isQuitting || this.isHiddenToTray) {
        return;
      }

      const detail = this.getCloseConfirmationDetail();
      if (!detail) {
        return;
      }

      const choice = dialog.showMessageBoxSync(window, {
        type: 'question',
        buttons: ['Cancel', 'Close Launcher'],
        defaultId: 0,
        cancelId: 0,
        title: 'Close Launcher?',
        message: 'Are you sure you want to close the launcher?',
        detail,
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
   * - When Invoke first starts successfully, hide the launcher to the tray (if enabled). This applies in server mode
   *   too - the tray is exactly the point there, since the launcher is the only window.
   * - When Invoke shuts down normally while it was auto-hidden after startup, quit the launcher entirely.
   * - When Invoke errors or its window crashes while hidden, restore the launcher so the user can see what happened.
   */
  handleInvokeStatusChange = (status: WithTimestamp<InvokeProcessStatus>): void => {
    const previousStatusType = this.invokeStatusType;
    this.invokeStatusType = status.type;

    switch (status.type) {
      case 'running': {
        // Only auto-hide on a genuine first start (starting -> running). Reopening the window after a crash goes
        // window-crashed -> running via reopenWindow(), and must not make the just-restored window vanish again.
        if (previousStatusType === 'starting' && this.store.get('hideLauncherAfterStartup')) {
          this.hideToTray({ auto: true });
        }
        break;
      }
      case 'exited': {
        // A normal shutdown (user closed Invoke, or it exited cleanly). Only quit if we auto-hid after startup - a
        // manual "minimize to tray" should keep the launcher available in the tray instead.
        if (this.autoHiddenAfterStartup) {
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
   * React to install process status changes. Installs never auto-hide the launcher, but the user may have manually
   * minimized it - if an install finishes or fails while hidden, bring the launcher back so the result is visible.
   */
  handleInstallStatusChange = (status: WithTimestamp<InstallProcessStatus>): void => {
    this.installStatusType = status.type;

    if (this.isHiddenToTray && (status.type === 'completed' || status.type === 'canceled' || status.type === 'error')) {
      this.showFromTray();
    }
  };

  /**
   * Whether the Invoke process is currently alive (starting up, running, or running-but-window-crashed).
   */
  private isInvokeProcessActive = (): boolean => {
    return (
      this.invokeStatusType === 'starting' ||
      this.invokeStatusType === 'running' ||
      this.invokeStatusType === 'window-crashed'
    );
  };

  /**
   * Inject the source of truth for whether Invoke currently has a live window. Wired from the Invoke manager so the
   * close-confirmation reflects the real window state instead of re-deriving it from `serverMode` (which the user can
   * toggle mid-session, making the dialog lie in both directions).
   */
  setInvokeWindowChecker = (hasWindow: () => boolean): void => {
    this.invokeHasWindow = hasWindow;
  };

  /**
   * Build the confirmation detail text shown when the user tries to close the launcher window, or `null` if no
   * confirmation is needed. The message reflects what closing the launcher will actually do.
   */
  private getCloseConfirmationDetail = (): string | null => {
    const isInstallActive = this.installStatusType === 'starting' || this.installStatusType === 'installing';
    if (isInstallActive) {
      return 'An installation is in progress. Closing the launcher will cancel it. Are you sure you want to continue?';
    }

    if (!this.isInvokeProcessActive()) {
      return null;
    }

    if (this.invokeHasWindow()) {
      // The Invoke window keeps the process alive, so closing the launcher just loses the logs/controls.
      return 'The Invoke window will stay open and Invoke will keep running, but you will lose access to the launcher and its logs. Close the launcher anyway?';
    }

    // The launcher is the only window (server mode, still starting, or the Invoke window crashed), so closing it will
    // shut Invoke down.
    return 'Closing the launcher will shut down Invoke. Are you sure you want to continue?';
  };

  /**
   * Hide the launcher window to the system tray. If no system tray is available, fall back to a normal minimize so the
   * window stays recoverable from the taskbar/Dock.
   *
   * @param options.auto Whether this hide was triggered automatically after startup (arms quit-on-normal-shutdown).
   */
  hideToTray = (options?: { auto?: boolean }): void => {
    if (!this.window || this.window.isDestroyed() || this.isHiddenToTray) {
      return;
    }
    if (this.createTray()) {
      // True "hide to tray": the window leaves the taskbar and is only recoverable through our own code, so it is safe
      // to track hidden/auto state and drive restore-on-crash and quit-on-normal-shutdown off it.
      this.window.hide();
      this.isHiddenToTray = true;
      this.autoHiddenAfterStartup = options?.auto ?? false;
    } else {
      // No usable tray host - degrade to a plain minimize. Crucially we do NOT set the hidden/auto flags: a minimized
      // window is reachable from the taskbar/Dock and the user can restore it with no code of ours running, which would
      // otherwise leave those flags stale-true forever (suppressing the close-confirmation and quitting a visible
      // launcher). Minimizing without the flags keeps every gated behavior correct.
      this.window.minimize();
    }
  };

  /**
   * Restore the launcher window from the system tray and remove the tray icon.
   */
  showFromTray = (): void => {
    this.isHiddenToTray = false;
    this.autoHiddenAfterStartup = false;
    this.destroyTray();
    const window = this.window;
    if (!window || window.isDestroyed()) {
      return;
    }
    // show() alone does not clear a minimized state, so restore first if needed.
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
  };

  /**
   * Bring the launcher window to the foreground from the tray, a minimized state, or the background. If the window was
   * closed entirely (e.g. in desktop mode where the Invoke window keeps the app alive), recreate it - otherwise the
   * single-instance relaunch and the macOS Dock/activate handlers would silently do nothing, leaving no route back.
   */
  focusOrRestore = (): void => {
    const window = this.window;
    // Check for a gone window FIRST. If the launcher was closed (desktop mode keeps Invoke's window alive), recreate it -
    // this must win over the tray branch, since showFromTray() gives up on a null window and would leave no route back.
    if (!window || window.isDestroyed()) {
      this.createWindow();
      return;
    }
    if (this.isHiddenToTray) {
      this.showFromTray();
      return;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
  };

  /**
   * Create the system tray icon. Returns whether a tray was successfully created (some platforms have no tray host and
   * throw here). A tray that "succeeds" but renders nothing on the desktop is still recoverable via the single-instance
   * lock and the macOS activate handler.
   */
  private createTray = (): boolean => {
    if (this.tray) {
      return true;
    }
    if (this.trayCreationFailed) {
      // We already tried and the platform threw - don't reconstruct and re-throw on every hide.
      return false;
    }
    try {
      // Hand Electron the full-resolution RGBA icon rather than a pre-scaled bitmap. There is only a single 1x
      // representation, so this is about the alpha channel and letting Electron do the downscale, not multi-DPI.
      const image = nativeImage.createFromPath(trayIconPath);
      const tray = new Tray(image);
      tray.setToolTip('Invoke Community Edition');
      // All restore paths are deferred out of the tray's own event/menu callbacks via setImmediate, so we never destroy
      // the tray from inside one of its handlers.
      const contextMenu = Menu.buildFromTemplate([
        { label: 'Show Launcher', click: () => setImmediate(this.showFromTray) },
        { type: 'separator' },
        { label: 'Quit', click: () => setImmediate(() => app.quit()) },
      ]);
      tray.setContextMenu(contextMenu);
      // On Windows/Linux a left click should restore the window. On macOS a click opens the context menu, so we don't
      // bind it there and rely on the "Show Launcher" item and the Dock instead.
      if (process.platform !== 'darwin') {
        tray.on('click', () => setImmediate(this.showFromTray));
        tray.on('double-click', () => setImmediate(this.showFromTray));
      }
      this.tray = tray;
      return true;
    } catch (error) {
      console.error('Failed to create system tray icon:', error);
      this.trayCreationFailed = true;
      return false;
    }
  };

  private destroyTray = (): void => {
    if (this.tray) {
      this.tray.closeContextMenu();
      this.tray.destroy();
      this.tray = null;
    }
  };

  cleanup = () => {
    this.destroyTray();
    this.closeWindow();
  };
}
