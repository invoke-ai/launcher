import { objectEquals } from '@observ33r/object-equals';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import { atom, computed } from 'nanostores';

import { STATUS_POLL_INTERVAL_MS } from '@/renderer/constants';
import { emitter, ipc } from '@/renderer/services/ipc';
import { syncInstallDirDetails } from '@/renderer/services/store';
import type { InvokeProcessStatus, WithTimestamp } from '@/shared/types';

export const getIsInvokeProcessActive = (status: InvokeProcessStatus) => {
  switch (status.type) {
    case 'running':
    case 'starting':
    case 'exiting':
      return true;
    default:
      return false;
  }
};

export const $invokeProcessStatus = atom<WithTimestamp<InvokeProcessStatus>>({
  type: 'uninitialized',
  timestamp: Date.now(),
});
export const $isInvokeProcessActive = computed($invokeProcessStatus, getIsInvokeProcessActive);
export const $isInvokeProcessPendingDismissal = atom(false);

$invokeProcessStatus.subscribe((status, oldStatus) => {
  if (oldStatus && getIsInvokeProcessActive(oldStatus) && !getIsInvokeProcessActive(status)) {
    $isInvokeProcessPendingDismissal.set(true);
  }
});

// Xterm terminal for displaying logs with proper terminal control sequence handling
export const $invokeProcessTerminal = atom<{ terminal: Terminal; fitAddon: FitAddon } | null>(null);

const listen = () => {
  ipc.on('invoke-process:log', (_, data) => {
    // Write raw data to xterm terminal if available
    const terminal = $invokeProcessTerminal.get();
    if (terminal) {
      // Write the raw message with ANSI codes to xterm
      terminal.terminal.write(data.message);
    }
  });

  ipc.on('invoke-process:clear-logs', () => {
    // Write raw data to xterm terminal if available
    const terminal = $invokeProcessTerminal.get();
    if (terminal) {
      // Write the raw message with ANSI codes to xterm
      terminal.terminal.reset();
    }
  });

  ipc.on('invoke-process:status', (_, status) => {
    $invokeProcessStatus.set(status);
    if (status.type === 'exited' || status.type === 'error') {
      // If the invoke process errored, we need to force a sync of the install dir details in case something broke
      syncInstallDirDetails();
    }
  });

  const poll = async () => {
    const oldStatus = $invokeProcessStatus.get();
    const newStatus = await emitter.invoke('invoke-process:get-status');
    if (objectEquals(oldStatus, newStatus)) {
      return;
    }
    $invokeProcessStatus.set(newStatus);
  };

  setInterval(poll, STATUS_POLL_INTERVAL_MS);
};

listen();
