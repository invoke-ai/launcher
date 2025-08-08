import { useStore } from '@nanostores/react';
import { startCase } from 'es-toolkit/compat';
import { memo } from 'react';

import {
  $invokeProcessStatus,
  $invokeProcessXTerm,
  getIsInvokeProcessActive,
} from '@/renderer/features/LaunchFlow/state';
import { UIMemoryMonitor } from '@/renderer/features/LaunchFlow/UIMemoryMonitor';
import { XTermLogViewer } from '@/renderer/features/XTermLogViewer/XTermLogViewer';
import { XTermLogViewerStatusIndicator } from '@/renderer/features/XTermLogViewer/XTermLogViewerStatusIndicator';
import type { InvokeProcessStatus } from '@/shared/types';

const getMessage = (status: InvokeProcessStatus) => {
  if (status.type === 'running') {
    return `Running at ${status.data.loopbackUrl}`;
  }
  return startCase(status.type);
};

export const LaunchFlowLogViewer = memo(() => {
  const invokeProcessStatus = useStore($invokeProcessStatus);

  return (
    <XTermLogViewer $xterm={$invokeProcessXTerm}>
      <UIMemoryMonitor position="absolute" top={2} left={2} />
      <XTermLogViewerStatusIndicator
        isLoading={getIsInvokeProcessActive(invokeProcessStatus)}
        position="absolute"
        top={2}
        right={2}
      >
        {getMessage(invokeProcessStatus)}
      </XTermLogViewerStatusIndicator>
    </XTermLogViewer>
  );
});
LaunchFlowLogViewer.displayName = 'LaunchFlowLogViewer';
