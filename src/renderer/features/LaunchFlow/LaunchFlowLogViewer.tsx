import { useStore } from '@nanostores/react';
import { startCase } from 'es-toolkit/compat';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  $invokeProcessStatus,
  $invokeProcessXTerm,
  getIsInvokeProcessActive,
} from '@/renderer/features/LaunchFlow/state';
import { XTermLogViewer } from '@/renderer/features/XTermLogViewer/XTermLogViewer';
import { XTermLogViewerStatusIndicator } from '@/renderer/features/XTermLogViewer/XTermLogViewerStatusIndicator';
import type { InvokeProcessStatus } from '@/shared/types';

const STATUS_KEY: Record<string, string> = {
  uninitialized: 'launchFlow.status.uninitialized',
  starting: 'launchFlow.status.starting',
  exiting: 'launchFlow.status.exiting',
  exited: 'launchFlow.status.exited',
  'window-crashed': 'launchFlow.status.windowCrashed',
};

const getMessage = (status: InvokeProcessStatus, t: ReturnType<typeof useTranslation>['t']) => {
  if (status.type === 'running') {
    return t('launchFlow.runningAt', { loopbackUrl: status.data.loopbackUrl });
  }
  const key = STATUS_KEY[status.type];
  if (key) {
    return t(key);
  }
  return startCase(status.type);
};

export const LaunchFlowLogViewer = memo(() => {
  const { t } = useTranslation();
  const invokeProcessStatus = useStore($invokeProcessStatus);

  return (
    <XTermLogViewer $xterm={$invokeProcessXTerm}>
      <XTermLogViewerStatusIndicator
        isLoading={getIsInvokeProcessActive(invokeProcessStatus)}
        position="absolute"
        top={2}
        right={2}
      >
        {getMessage(invokeProcessStatus, t)}
      </XTermLogViewerStatusIndicator>
    </XTermLogViewer>
  );
});
LaunchFlowLogViewer.displayName = 'LaunchFlowLogViewer';
