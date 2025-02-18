import { isEqual } from 'lodash-es';
import { atom } from 'nanostores';

import { STATUS_POLL_INTERVAL_MS } from '@/renderer/constants';
import { emitter, ipc } from '@/renderer/services/ipc';
import type { MainProcessStatus, WithTimestamp } from '@/shared/types';

/**
 * A nanostores atom that holds the status of the main process, wrapped in a timestamp.
 */
const $mainProcessStatus = atom<WithTimestamp<MainProcessStatus>>({
  type: 'initializing',
  timestamp: Date.now(),
});

/**
 * Listen for main process status updates and poll for updates.
 */
const listen = () => {
  ipc.on('main-process:status', (_, data) => {
    $mainProcessStatus.set(data);
  });

  const poll = async () => {
    const oldStatus = $mainProcessStatus.get();
    const newStatus = await emitter.invoke('main-process:get-status');
    if (isEqual(oldStatus, newStatus)) {
      return;
    }
    $mainProcessStatus.set(newStatus);
  };

  setInterval(poll, STATUS_POLL_INTERVAL_MS);
};

listen();
