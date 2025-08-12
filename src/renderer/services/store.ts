import type { ReadableAtom } from 'nanostores';
import { atom } from 'nanostores';

import { emitter, ipc } from '@/renderer/services/ipc';
import type { DirDetails, OperatingSystem, StoreData } from '@/shared/types';

const getDefaults = (): StoreData => ({
  serverMode: false,
  notifyForPrereleaseUpdates: true,
  optInToLauncherPrereleases: false,
});

/**
 * Private atom that holds the store data. Use `persistedStoreApi` to interact with the store.
 */
const _$store = atom<StoreData>(getDefaults());

ipc.on('store:changed', (_, data) => {
  _$store.set(data ?? getDefaults());
});

/**
 * An API to interact with the persisted store.
 */
export const persistedStoreApi = {
  /**
   * The public atom that holds the store data. Use this atom to subscribe to store changes or consume the store data
   * in React.
   *
   * Changes to the store made from both main and renderer processes will be reflected in this atom.
   */
  $atom: _$store as ReadableAtom<StoreData>,
  /**
   * Set a key in the store. This will update the store and persist the change.
   */
  setKey: <K extends keyof StoreData>(key: K, value: StoreData[K]): Promise<void> => {
    return emitter.invoke('store:set-key', key, value);
  },
  /**
   * Get a key from the store. This is read from the in-memory store and does not make a round-trip to the main process.
   */
  getKey: <K extends keyof StoreData>(key: K): StoreData[K] => {
    return _$store.get()[key];
  },
  /**
   * Set the entire store. This will update the store and persist the change.
   */
  set: (data: StoreData): Promise<void> => {
    return emitter.invoke('store:set', data);
  },
  /**
   * Get the entire store. This is read from the in-memory store and does not make a round-trip to the main process.
   */
  get: (): StoreData => {
    return _$store.get();
  },
  /**
   * Reset the entire store to its default values. This will update the store and persist the change.
   */
  reset: (): Promise<void> => {
    return emitter.invoke('store:reset');
  },
  /**
   * Force a sync of the store with the main process. This will update the in-memory store with the persisted store data.
   */
  sync: async () => {
    const data = await emitter.invoke('store:get');
    _$store.set(data);
  },
};

/**
 * A helper function to select the install directory. This will open a dialog for the user to select a directory and
 * update the store with the selected directory.
 */
export const selectInstallDir = async () => {
  const installDir = persistedStoreApi.getKey('installDir');
  const newInstallDir = await emitter.invoke('util:select-directory', installDir);
  if (newInstallDir) {
    persistedStoreApi.setKey('installDir', newInstallDir);
  }
};

/**
 * An atom that holds the initialization state of the store. This is used to determine when the store is ready to be
 * consumed. The app should wait for this atom to be `true` before allowing user interaction.
 */
export const $initialized = atom(false);

/**
 * An atom that holds the details of the selected installation directory. This data is not persisted to the store but is
 * fetched from the main process whenever the selected installation directory changes.
 */
export const $installDirDetails = atom<DirDetails | undefined>(undefined);

/**
 * A helper function to force a sync of the details of the selected installation directory. This is useful after an
 * install or update operation to ensure the details are up-to-date.
 */
export const syncInstallDirDetails = async () => {
  const installDir = persistedStoreApi.$atom.get().installDir;
  if (!installDir) {
    return;
  }
  const newDirDetails = await emitter.invoke('util:get-dir-details', installDir);
  $installDirDetails.set(newDirDetails);
};

persistedStoreApi.$atom.listen(async () => {
  const installDir = persistedStoreApi.$atom.get().installDir;
  const dirDetails = $installDirDetails.get();

  if (!installDir) {
    $installDirDetails.set(undefined);
  } else if (installDir !== dirDetails?.path) {
    const newDirDetails = await emitter.invoke('util:get-dir-details', installDir);
    $installDirDetails.set(newDirDetails);
  }

  $initialized.set(true);
});

/**
 * An atom that holds the operating system of the user. This is fetched from the main process when the app starts.
 */
export const $operatingSystem = atom<OperatingSystem | undefined>(undefined);

// Fetch the operating system from the main process and set it in the store when the app starts
emitter.invoke('util:get-os').then($operatingSystem.set);

// Sync the store with the main process when the app starts
persistedStoreApi.sync();
