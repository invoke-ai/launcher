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
    ipc.on('invoke-process:clear-logs', () => {
      xterm.reset();
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

const teardownTerminal = () => {
  for (const unsubscribe of terminalSubscriptions) {
    unsubscribe();
  }
  const xterm = $invokeProcessXTerm.get();
  if (!xterm) {
    return;
  }
  xterm.dispose();
};

const listen = () => {
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
