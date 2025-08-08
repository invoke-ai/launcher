import { Button, Heading, Text, VStack } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo } from 'react';

import { BodyContainer, BodyContent, BodyFooter } from '@/renderer/common/layout';
import { LaunchFlowLogViewer } from '@/renderer/features/LaunchFlow/LaunchFlowLogViewer';
import {
  $invokeProcessStatus,
  $isInvokeProcessPendingDismissal,
  teardownTerminal,
} from '@/renderer/features/LaunchFlow/state';
import { emitter } from '@/renderer/services/ipc';

const quit = async () => {
  await emitter.invoke('invoke-process:exit-invoke');
  $isInvokeProcessPendingDismissal.set(true);
};

const dismissPostInvoke = () => {
  teardownTerminal();
  $isInvokeProcessPendingDismissal.set(false);
};

const reopenWindow = async () => {
  await emitter.invoke('invoke-process:reopen-window');
};

export const LaunchFlowRunning = memo(() => {
  const invokeProcessStatus = useStore($invokeProcessStatus);
  const isInvokeProcessPendingDismissal = useStore($isInvokeProcessPendingDismissal);

  return (
    <BodyContainer>
      <BodyContent>
        {invokeProcessStatus.type === 'window-crashed' && (
          <VStack gap={4} alignItems="center" justifyContent="center" h="full">
            <Heading size="lg">Window Crashed</Heading>
            <Text color="base.300">The Invoke UI window closed unexpectedly, but the server is still running.</Text>
            <Text color="base.300">You can reopen the window or shutdown the server.</Text>
          </VStack>
        )}
        <LaunchFlowLogViewer />
      </BodyContent>
      <BodyFooter>
        {isInvokeProcessPendingDismissal && (
          <Button variant="ghost" onClick={dismissPostInvoke}>
            Back
          </Button>
        )}
        {!isInvokeProcessPendingDismissal && invokeProcessStatus.type !== 'window-crashed' && (
          <Button
            onClick={quit}
            isLoading={invokeProcessStatus.type === 'exiting'}
            loadingText="Shutting down"
            colorScheme="error"
          >
            Shutdown
          </Button>
        )}
        {!isInvokeProcessPendingDismissal && invokeProcessStatus.type === 'window-crashed' && (
          <Button onClick={reopenWindow} colorScheme="invokeGreen">
            Reopen Window
          </Button>
        )}
        {!isInvokeProcessPendingDismissal && invokeProcessStatus.type === 'window-crashed' && (
          <Button onClick={quit} colorScheme="error">
            Shutdown Server
          </Button>
        )}
      </BodyFooter>
    </BodyContainer>
  );
});

LaunchFlowRunning.displayName = 'LaunchFlowRunning';
