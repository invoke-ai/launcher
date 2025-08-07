import { Button } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo } from 'react';

import { BodyContainer, BodyContent, BodyFooter } from '@/renderer/common/layout';
import { LaunchFlowLogViewer } from '@/renderer/features/LaunchFlow/LaunchFlowLogViewer';
import { $invokeProcessStatus, $isInvokeProcessPendingDismissal } from '@/renderer/features/LaunchFlow/state';
import { emitter } from '@/renderer/services/ipc';

const quit = async () => {
  await emitter.invoke('invoke-process:exit-invoke');
  $isInvokeProcessPendingDismissal.set(true);
};

const dismissPostInvoke = () => {
  $isInvokeProcessPendingDismissal.set(false);
};

export const LaunchFlowRunning = memo(() => {
  const invokeProcessStatus = useStore($invokeProcessStatus);
  const isInvokeProcessPendingDismissal = useStore($isInvokeProcessPendingDismissal);

  return (
    <BodyContainer>
      <BodyContent>
        <LaunchFlowLogViewer />
      </BodyContent>
      <BodyFooter>
        {isInvokeProcessPendingDismissal && (
          <Button variant="ghost" onClick={dismissPostInvoke}>
            Back
          </Button>
        )}
        {!isInvokeProcessPendingDismissal && (
          <Button
            onClick={quit}
            isLoading={invokeProcessStatus.type === 'exiting'}
            loadingText="Shutting down"
            colorScheme="error"
          >
            Shutdown
          </Button>
        )}
      </BodyFooter>
    </BodyContainer>
  );
});

LaunchFlowRunning.displayName = 'LaunchFlowRunning';
