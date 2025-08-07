import { useStore } from '@nanostores/react';
import { memo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { ErrorBoundaryFallback } from '@/renderer/app/ErrorBoundaryFallback';
import { LaunchFlowInvalidInstall } from '@/renderer/features/LaunchFlow/LaunchFlowCannotFindInstall';
import { LaunchFlowNotRunning } from '@/renderer/features/LaunchFlow/LaunchFlowNotRunning';
import { LaunchFlowRunning } from '@/renderer/features/LaunchFlow/LaunchFlowRunning';
import { LaunchFlowWindowCrashed } from '@/renderer/features/LaunchFlow/LaunchFlowWindowCrashed';
import {
  $invokeProcessStatus,
  $isInvokeProcessActive,
  $isInvokeProcessPendingDismissal,
} from '@/renderer/features/LaunchFlow/state';
import { emitter } from '@/renderer/services/ipc';
import type { DirDetails } from '@/shared/types';

type Props = {
  installDirDetails: DirDetails;
};

const LaunchFlowContent = memo(({ installDirDetails }: Props) => {
  const invokeProcessStatus = useStore($invokeProcessStatus);
  const isInvokeProcessActive = useStore($isInvokeProcessActive);
  const isInvokeProcessPendingDismissal = useStore($isInvokeProcessPendingDismissal);

  if (invokeProcessStatus.type === 'window-crashed') {
    return <LaunchFlowWindowCrashed />;
  }

  if (isInvokeProcessActive || isInvokeProcessPendingDismissal) {
    return <LaunchFlowRunning />;
  }

  if (!installDirDetails.isInstalled) {
    return <LaunchFlowInvalidInstall installDirDetails={installDirDetails} />;
  }

  return <LaunchFlowNotRunning installDirDetails={installDirDetails} />;
});
LaunchFlowContent.displayName = 'LaunchFlowContent';

const resetInstallDir = () => {
  emitter.invoke('store:set-key', 'installDir', undefined);
};

export const LaunchFlow = memo(({ installDirDetails }: Props) => {
  return (
    <ErrorBoundary FallbackComponent={ErrorBoundaryFallback} onReset={resetInstallDir}>
      <LaunchFlowContent installDirDetails={installDirDetails} />
    </ErrorBoundary>
  );
});
LaunchFlow.displayName = 'LaunchFlow';
