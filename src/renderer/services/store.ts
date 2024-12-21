import type { ReadableAtom } from 'nanostores';
import { atom } from 'nanostores';

import { emitter, ipc } from '@/renderer/services/ipc';
import type { DirDetails, OperatingSystem, StoreData } from '@/shared/types';

const getDefaults = (): StoreData => ({ serverMode: false, notifyForPrereleaseUpdates: true });

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
 * An atom that holds the initialization state of the store. This is used to determine when the store is ready to be
 * consumed. The app should wait for this atom to be `true` before allowing user interaction.
 */
export const $initialized = atom(false);

/**
 * An atom that holds the details of the selected installation directory. This data is not persisted to the store but is
 * fetched from the main process whenever the selected installation directory changes.
 */
export const $installDirDetails = atom<DirDetails | undefined>(undefined);

export const syncInstallDirDetails = async (installDir: string) => {
  const newDirDetails = await emitter.invoke('util:get-dir-details', installDir);
  $installDirDetails.set(newDirDetails);
};

persistedStoreApi.$atom.listen(() => {
  const installDir = persistedStoreApi.$atom.get().installDir;
  const dirDetails = $installDirDetails.get();

  if (!installDir) {
    $installDirDetails.set(undefined);
  } else if (installDir !== dirDetails?.path) {
    syncInstallDirDetails(installDir);
  }

  $initialized.set(true);
});

export const $operatingSystem = atom<OperatingSystem | undefined>(undefined);
emitter.invoke('util:get-os').then($operatingSystem.set);

persistedStoreApi.sync();
