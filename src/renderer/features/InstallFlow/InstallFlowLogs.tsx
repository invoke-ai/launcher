import { useStore } from '@nanostores/react';
import { startCase } from 'es-toolkit/compat';
import { memo } from 'react';

import {
  $installProcessStatus,
  $installProcessXTerm,
  getIsActiveInstallProcessStatus,
} from '@/renderer/features/InstallFlow/state';
import { XTermLogViewer } from '@/renderer/features/XTermLogViewer/XTermLogViewer';
import { XTermLogViewerStatusIndicator } from '@/renderer/features/XTermLogViewer/XTermLogViewerStatusIndicator';

export const InstallFlowLogs = memo(() => {
  const installProcessStatus = useStore($installProcessStatus);

  return (
    <XTermLogViewer $xterm={$installProcessXTerm}>
      <XTermLogViewerStatusIndicator
        isLoading={getIsActiveInstallProcessStatus(installProcessStatus)}
        position="absolute"
        top={2}
        right={2}
      >
        {startCase(installProcessStatus.type)}
      </XTermLogViewerStatusIndicator>
    </XTermLogViewer>
  );
});
InstallFlowLogs.displayName = 'InstallFlowLogs';
