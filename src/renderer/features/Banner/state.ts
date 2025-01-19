import { atom, onMount, task } from 'nanostores';

import { emitter } from '@/renderer/services/ipc';

export const $launcherVersion = atom<string | null>(null);

onMount($launcherVersion, () => {
  task(async () => {
    const launcherVersion = await emitter.invoke('util:get-launcher-version');
    $launcherVersion.set(launcherVersion);
  });
});
