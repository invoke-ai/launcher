import { useStore } from '@nanostores/react';
import { startCase } from 'es-toolkit/compat';
import { memo } from 'react';

import {
  $installProcessStatus,
  $installProcessTerminal,
  getIsActiveInstallProcessStatus,
} from '@/renderer/features/InstallFlow/state';
import { XtermLogViewer } from '@/renderer/features/XTermLogViewer/XtermLogViewer';
import { XTermLogViewerStatusIndicator } from '@/renderer/features/XTermLogViewer/XTermLogViewerStatusIndicator';

export const InstallFlowLogs = memo(() => {
  const installProcessStatus = useStore($installProcessStatus);

  return (
    <XtermLogViewer $terminal={$installProcessTerminal}>
      <XTermLogViewerStatusIndicator
        isLoading={getIsActiveInstallProcessStatus(installProcessStatus)}
        position="absolute"
        top={2}
        right={2}
      >
        {startCase(installProcessStatus.type)}
      </XTermLogViewerStatusIndicator>
    </XtermLogViewer>
  );
});
InstallFlowLogs.displayName = 'InstallFlowLogs';
