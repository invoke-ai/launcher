import { useStore } from '@nanostores/react';
import { startCase } from 'es-toolkit/compat';
import { memo } from 'react';

import {
  $installProcessLogs,
  $installProcessStatus,
  getIsActiveInstallProcessStatus,
} from '@/renderer/features/InstallFlow/state';
import { LogViewer } from '@/renderer/features/LogViewer/LogViewer';
import { LogViewerStatusIndicator } from '@/renderer/features/LogViewer/LogViewerStatusIndicator';

export const InstallFlowLogs = memo(() => {
  const installProcessLogs = useStore($installProcessLogs);
  const installProcessStatus = useStore($installProcessStatus);
  return (
    <LogViewer logs={installProcessLogs}>
      <LogViewerStatusIndicator
        isLoading={getIsActiveInstallProcessStatus(installProcessStatus)}
        position="absolute"
        top={2}
        right={2}
      >
        {startCase(installProcessStatus.type)}
      </LogViewerStatusIndicator>
    </LogViewer>
  );
});
InstallFlowLogs.displayName = 'InstallFlowLogs';
