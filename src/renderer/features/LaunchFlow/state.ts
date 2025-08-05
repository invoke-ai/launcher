import { objectEquals } from '@observ33r/object-equals';
import { atom, computed } from 'nanostores';

import { LineBuffer } from '@/lib/line-buffer';
import { INVOKE_PROCESS_LOG_LIMIT, STATUS_POLL_INTERVAL_MS } from '@/renderer/constants';
import { emitter, ipc } from '@/renderer/services/ipc';
import { syncInstallDirDetails } from '@/renderer/services/store';
import type { InvokeProcessStatus, LogEntry, WithTimestamp } from '@/shared/types';

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

export const $invokeProcessLogs = atom<WithTimestamp<LogEntry>[]>([]);
const appendToInvokeProcessLogs = (entry: WithTimestamp<LogEntry>) => {
  $invokeProcessLogs.set([...$invokeProcessLogs.get(), entry].slice(-INVOKE_PROCESS_LOG_LIMIT));
};

const listen = () => {
  const buffer = new LineBuffer({ stripAnsi: true });

  ipc.on('invoke-process:log', (_, data) => {
    const buffered = buffer.append(data.message);
    for (const message of buffered) {
      appendToInvokeProcessLogs({ ...data, message });
    }
  });

  ipc.on('invoke-process:status', (_, status) => {
    $invokeProcessStatus.set(status);
    if (status.type === 'exited' || status.type === 'error') {
      // Flush the buffer when the process exits in case there were any remaining logs
      const finalMessage = buffer.flush();
      const lastLog = $invokeProcessLogs.get().slice(-1)[0];
      if (lastLog && finalMessage) {
        appendToInvokeProcessLogs({ ...lastLog, message: finalMessage });
      }

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
