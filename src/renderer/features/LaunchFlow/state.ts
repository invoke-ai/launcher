import { objectEquals } from '@observ33r/object-equals';
import { Terminal } from '@xterm/xterm';
import { atom, computed } from 'nanostores';

import { DEFAULT_XTERM_OPTIONS, STATUS_POLL_INTERVAL_MS } from '@/renderer/constants';
import { emitter, ipc } from '@/renderer/services/ipc';
import { syncInstallDirDetails } from '@/renderer/services/store';
import type { InvokeProcessStatus, WithTimestamp } from '@/shared/types';

export const getIsInvokeProcessActive = (status: InvokeProcessStatus) => {
  switch (status.type) {
    case 'running':
    case 'starting':
    case 'exiting':
    case 'window-crashed':
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

export const $invokeProcessXTerm = atom<Terminal | null>(null);
const terminalSubscriptions = new Set<() => void>();

const initializeTerminal = (): Terminal => {
  let xterm = $invokeProcessXTerm.get();

  if (xterm) {
    return xterm;
  }

  xterm = new Terminal({ ...DEFAULT_XTERM_OPTIONS, disableStdin: true });

  terminalSubscriptions.add(
    ipc.on('invoke-process:log', (_, data) => {
      // Only handle structured logs that aren't from PTY
      // PTY output comes through the raw-output channel
      xterm.write(data.message);
    })
  );

  terminalSubscriptions.add(
    ipc.on('invoke-process:raw-output', (_, data) => {
      // Write raw PTY output directly to xterm terminal
      xterm.write(data);
    })
  );

  terminalSubscriptions.add(
    xterm.onResize(({ cols, rows }) => {
      emitter.invoke('invoke-process:resize', cols, rows);
    }).dispose
  );

  $invokeProcessXTerm.set(xterm);
  return xterm;
};

export const teardownTerminal = () => {
  for (const unsubscribe of terminalSubscriptions) {
    unsubscribe();
  }
  terminalSubscriptions.clear();
  const xterm = $invokeProcessXTerm.get();
  if (!xterm) {
    return;
  }
  xterm.dispose();
  $invokeProcessXTerm.set(null);
};

export const startInvoke = (location: string) => {
  // Initialize terminal BEFORE starting the invoke process
  // This ensures handlers are ready to receive output
  initializeTerminal();
  emitter.invoke('invoke-process:start-invoke', location);
};

const listen = () => {
  ipc.on('invoke-process:status', (_, status) => {
    const oldStatus = $invokeProcessStatus.get();
    $invokeProcessStatus.set(status);

    // Initialize terminal when starting
    if (status.type === 'starting' && oldStatus.type !== 'starting') {
      initializeTerminal();
    }

    // Only sync install dir details when process exits with error
    // Don't teardown terminal - keep it alive so user can see the logs
    if (status.type === 'error') {
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
