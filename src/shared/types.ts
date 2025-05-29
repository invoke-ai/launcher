import type { Rectangle } from 'electron/main';
import type { Schema } from 'electron-store';

// Normally we'd use SWR or some query library, but I had some issues with react render cycles and the easiest fix
// was to just move all the fetching outside react. Also SWR doesn't narrow its data field when the request is
// successful, which is suuuuper annoying. This type provides a similar API, but better types. Just have to implement
// the fetching logic yourself.
export type AsyncRequest<T, E> =
  | {
      isUninitialized: true;
      isLoading: false;
      isError: false;
      isSuccess: false;
    }
  | {
      isUninitialized: false;
      isLoading: true;
      isError: false;
      isSuccess: false;
    }
  | {
      isUninitialized: false;
      isLoading: false;
      isError: true;
      isSuccess: false;
      error: E;
    }
  | {
      isUninitialized: false;
      isLoading: false;
      isError: false;
      isSuccess: true;
      data: T;
    };

/**
 * Window size and position properties, used to save and restore window state.
 */
export type WindowProps = {
  bounds: Rectangle;
  isMaximized: boolean;
  isFullScreen: boolean;
};

/**
 * Data stored in the electron store.
 */
export type StoreData = {
  installDir?: string;
  serverMode: boolean;
  notifyForPrereleaseUpdates: boolean;
  launcherWindowProps?: WindowProps;
  appWindowProps?: WindowProps;
};

// The electron store uses JSON schema to validate its data.

/**
 * JSON schema for the window properties.
 */
const winSizePropsSchema = {
  type: 'object',
  properties: {
    bounds: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
      },
    },
    isMaximized: { type: 'boolean' },
    isFullScreen: { type: 'boolean' },
  },
};

/**
 * JSON schema for the store data.
 */
export const schema: Schema<StoreData> = {
  installDir: {
    type: 'string',
  },
  serverMode: {
    type: 'boolean',
    default: false,
  },
  notifyForPrereleaseUpdates: {
    type: 'boolean',
    default: true,
  },
  launcherWindowProps: winSizePropsSchema,
  appWindowProps: winSizePropsSchema,
};

/**
 * The type of GPU in the system. This and the operating system are used to determine:
 * - Whether to install xformers - torch's own SDP is faster for 30xx + series GPUs, otherwise xformers is faster.
 * - Which pypi indices to use for torch.
 */
export type GpuType = 'nvidia<30xx' | 'nvidia>=30xx' | 'amd' | 'nogpu';

/**
 * A map of GPU types to human-readable names.
 */
export const GPU_TYPE_MAP: Record<GpuType, string> = {
  'nvidia<30xx': 'Nvidia (20xx and below)',
  'nvidia>=30xx': 'Nvidia (30xx and above)',
  amd: 'AMD',
  nogpu: 'No dedicated GPU',
};

/**
 * Supported operating systems.
 */
export type OperatingSystem = 'Windows' | 'macOS' | 'Linux';

/**
 * A utility type that prefixes all keys in an object with a string using the specified separator.
 */
type Namespaced<Prefix extends string, T, Sep extends string = ':'> = {
  [K in keyof T as `${Prefix}${Sep}${string & K}`]: T[K];
};

/**
 * Details about a candidate directory for installation.
 */
export type DirDetails =
  // Directory is installed and can be launched
  | {
      path: string;
      isInstalled: true;
      canInstall: true;
      isDirectory: true;
      isFirstRun: boolean;
      version: string;
      pythonVersion: string;
      pythonPath: string;
      invokeExecPath: string;
      activateVenvPath: string;
    }
  // Directory is not installed but can be installed
  | {
      path: string;
      isDirectory: true;
      isInstalled: false;
      canInstall: true;
    }
  // Directory is not installed and can not be installed
  | {
      path: string;
      isDirectory: false;
      isInstalled: false;
      canInstall: false;
    };

/**
 * The type of installation to perform along with some context.
 */
export type InstallType =
  | {
      type: 'fresh';
      newVersion: string;
    }
  | {
      type: 'reinstall' | 'upgrade' | 'downgrade' | 'manual';
      newVersion: string;
      installedVersion: string;
    };

/**
 * A status object that may optionally contain data. It represents an OK/good status.
 */
type OkStatus<StatusType extends string, Data = void> = Data extends void
  ? {
      type: StatusType;
    }
  : {
      type: StatusType;
      data: Data;
    };

/**
 * A status object that contains an error message and optionally some context. It represents an ERROR/bad status.
 */
type ErrorStatus = {
  type: 'error';
  error: {
    message: string;
    context?: Record<string, unknown>;
  };
};

/**
 * A status object that may be either an OK status or an ERROR status.
 */
type Status<State extends string> = OkStatus<State> | ErrorStatus;

/**
 * The various states the main process can be in.
 */
export type MainProcessStatus = Status<'initializing' | 'idle' | 'exiting'>;

/**
 * The various states the install process can be in.
 */
export type InstallProcessStatus = Status<
  'uninitialized' | 'starting' | 'installing' | 'canceling' | 'exiting' | 'completed' | 'canceled'
>;

/**
 * The various states the invoke process can be in.
 */
export type InvokeProcessStatus =
  | Status<'uninitialized' | 'starting' | 'exiting' | 'exited'>
  | OkStatus<
      'running',
      {
        /**
         * The URL at which the server is running. The user can access the server from the host machine using this URL.
         */
        loopbackUrl: string;
        /**
         * The URL at which the server is running on the LAN. The user can access the server from other devices on the
         * same network using this URL. This field is only present if the server is accessible on the LAN.
         */
        lanUrl?: string;
        /**
         * The URL at which the server is running as reported by uvicorn. It may have 0.0.0.0 as the host.
         *
         * You probably want to use `loopbackUrl` instead.
         */
        url: string;
      }
    >;

/**
 * A logging level.
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * A log entry with a level and message.
 */
export type LogEntry = {
  level: LogLevel;
  message: string;
};

/**
 * A type that adds a timestamp to an object.
 */
export type WithTimestamp<T> = T & { timestamp: number };

/**
 * Options for creating a new terminal.
 */
export type PtyOptions = {
  /**
   * The initial current working directory for the terminal.
   */
  cwd?: string;
  /**
   * The initial size of the terminal.
   */
  size?: { cols: number; rows: number };
};

/**
 * Store API. Main process handles these events, renderer process invokes them.
 */
type StoreIpcEvents = Namespaced<
  'store',
  {
    'get-key': <K extends keyof StoreData>(key: K) => StoreData[K];
    'set-key': <K extends keyof StoreData>(key: K, val: StoreData[K]) => void;
    get: () => StoreData;
    set: (data: StoreData) => void;
    reset: () => void;
  }
>;

/**
 * Main Process API. Main process handles these events, renderer process invokes them.
 */
type MainProcessIpcEvents = Namespaced<
  'main-process',
  {
    'get-status': () => WithTimestamp<MainProcessStatus>;
    exit: () => void;
  }
>;

/**
 * Install Process API. Main process handles these events, renderer process invokes them.
 */
type InstallProcessIpcEvents = Namespaced<
  'install-process',
  {
    'get-status': () => WithTimestamp<InstallProcessStatus>;
    'start-install': (location: string, gpuType: GpuType, version: string, repair?: boolean) => void;
    'cancel-install': () => void;
  }
>;

/**
 * Invoke Process API. Main process handles these events, renderer process invokes them.
 */
type InvokeProcessIpcEvents = Namespaced<
  'invoke-process',
  {
    'get-status': () => WithTimestamp<InvokeProcessStatus>;
    'start-invoke': (location: string) => void;
    'exit-invoke': () => void;
  }
>;

/**
 * Utils API. Main process handles these events, renderer process invokes them.
 */
type UtilIpcEvents = Namespaced<
  'util',
  {
    'select-directory': (path?: string) => string | null;
    'get-home-directory': () => string;
    'get-is-directory': (path: string) => boolean;
    'get-is-file': (path: string) => boolean;
    'get-path-exists': (path: string) => boolean;
    'get-os': () => OperatingSystem;
    'get-dir-details': (path: string) => DirDetails;
    'get-default-install-dir': () => string;
    'open-directory': (path: string) => string;
    'get-launcher-version': () => string;
  }
>;

/**
 * Terminal API. Main process handles these events, renderer process invokes them.
 */
type TerminalIpcEvents = Namespaced<
  'terminal',
  {
    replay: (id: string) => string | null;
    create: (cwd?: string) => string;
    list: () => string[];
    write: (id: string, data: string) => void;
    resize: (id: string, cols: number, rows: number) => void;
    dispose: (id: string) => void;
  }
>;

/**
 * Intersection of all the events that the renderer can invoke and main process can handle.
 */
export type IpcEvents = MainProcessIpcEvents &
  InstallProcessIpcEvents &
  InvokeProcessIpcEvents &
  UtilIpcEvents &
  TerminalIpcEvents &
  StoreIpcEvents;

/**
 * Store events. Main process emits these events, renderer process listens to them.
 */
type StoreIpcRendererEvents = Namespaced<
  'store',
  {
    changed: [StoreData | undefined];
  }
>;

/**
 * Terminal events. Main process emits these events, renderer process listens to them.
 */
type TerminalIpcRendererEvents = Namespaced<
  'terminal',
  {
    output: [string, string];
    exited: [string, number];
  }
>;

/**
 * Main process events. Main process emits these events, renderer process listens to them.
 */
type MainProcessIpcRendererEvents = Namespaced<
  'main-process',
  {
    status: [WithTimestamp<MainProcessStatus>];
  }
>;

/**
 * Install process events. Main process emits these events, renderer process listens to them.
 */
type InstallProcessIpcRendererEvents = Namespaced<
  'install-process',
  {
    status: [WithTimestamp<InstallProcessStatus>];
    log: [WithTimestamp<LogEntry>];
  }
>;

/**
 * Invoke process events. Main process emits these events, renderer process listens to them.
 */
type InvokeProcessIpcRendererEvents = Namespaced<
  'invoke-process',
  {
    status: [WithTimestamp<InvokeProcessStatus>];
    log: [WithTimestamp<LogEntry>];
  }
>;

/**
 * Dev events. Main process emits these events, renderer process listens to them.
 */
type DevIpcRendererEvents = Namespaced<
  'dev',
  {
    'console-log': [unknown];
  }
>;

/**
 * Intersection of all the events emitted by main process that the renderer can listen to.
 */
export type IpcRendererEvents = TerminalIpcRendererEvents &
  MainProcessIpcRendererEvents &
  InstallProcessIpcRendererEvents &
  InvokeProcessIpcRendererEvents &
  DevIpcRendererEvents &
  StoreIpcRendererEvents;
