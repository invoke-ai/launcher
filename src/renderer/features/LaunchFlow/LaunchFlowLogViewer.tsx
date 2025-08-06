import { useStore } from '@nanostores/react';
import { startCase } from 'es-toolkit/compat';
import { memo } from 'react';

import {
  $invokeProcessLogs,
  $invokeProcessStatus,
  getIsInvokeProcessActive,
} from '@/renderer/features/LaunchFlow/state';
import { UIMemoryMonitor } from '@/renderer/features/LaunchFlow/UIMemoryMonitor';
import { LogViewer } from '@/renderer/features/LogViewer/LogViewer';
import { LogViewerStatusIndicator } from '@/renderer/features/LogViewer/LogViewerStatusIndicator';
import type { InvokeProcessStatus } from '@/shared/types';

const getMessage = (status: InvokeProcessStatus) => {
  if (status.type === 'running') {
    return `Running at ${status.data.loopbackUrl}`;
  }
  return startCase(status.type);
};

export const LaunchFlowLogViewer = memo(() => {
  const invokeProcessLogs = useStore($invokeProcessLogs);
  const invokeProcessStatus = useStore($invokeProcessStatus);

  return (
    <LogViewer logs={invokeProcessLogs}>
      <UIMemoryMonitor position="absolute" top={2} left={2} />
      <LogViewerStatusIndicator
        isLoading={getIsInvokeProcessActive(invokeProcessStatus)}
        position="absolute"
        top={2}
        right={2}
      >
        {getMessage(invokeProcessStatus)}
      </LogViewerStatusIndicator>
    </LogViewer>
  );
});
LaunchFlowLogViewer.displayName = 'LaunchFlowLogViewer';
