import { useStore } from '@nanostores/react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  $installProcessStatus,
  $installProcessXTerm,
  getIsActiveInstallProcessStatus,
} from '@/renderer/features/InstallFlow/state';
import { XTermLogViewer } from '@/renderer/features/XTermLogViewer/XTermLogViewer';
import { XTermLogViewerStatusIndicator } from '@/renderer/features/XTermLogViewer/XTermLogViewerStatusIndicator';

export const InstallFlowLogs = memo(() => {
  const { t } = useTranslation();
  const installProcessStatus = useStore($installProcessStatus);

  return (
    <XTermLogViewer $xterm={$installProcessXTerm}>
      <XTermLogViewerStatusIndicator
        isLoading={getIsActiveInstallProcessStatus(installProcessStatus)}
        position="absolute"
        top={2}
        right={2}
      >
        {t(`installFlow.status.${installProcessStatus.type}`)}
      </XTermLogViewerStatusIndicator>
    </XTermLogViewer>
  );
});
InstallFlowLogs.displayName = 'InstallFlowLogs';
