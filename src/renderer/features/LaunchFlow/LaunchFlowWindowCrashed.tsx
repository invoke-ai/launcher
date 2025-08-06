import { Button, Heading, Text, VStack } from '@invoke-ai/ui-library';
import { memo } from 'react';

import { BodyContainer, BodyContent, BodyFooter } from '@/renderer/common/layout';
import { LaunchFlowLogViewer } from '@/renderer/features/LaunchFlow/LaunchFlowLogViewer';
import { emitter } from '@/renderer/services/ipc';

const reopenWindow = async () => {
  await emitter.invoke('invoke-process:reopen-window');
};

const quit = async () => {
  await emitter.invoke('invoke-process:exit-invoke');
};

export const LaunchFlowWindowCrashed = memo(() => {
  return (
    <BodyContainer>
      <BodyContent>
        <VStack gap={4} alignItems="center" justifyContent="center" h="full">
          <Heading size="lg">Window Crashed</Heading>
          <Text color="base.300">The Invoke UI window closed unexpectedly, but the server is still running.</Text>
          <Text color="base.300">You can reopen the window or shutdown the server.</Text>
        </VStack>
        <LaunchFlowLogViewer />
      </BodyContent>
      <BodyFooter>
        <Button onClick={reopenWindow} colorScheme="invokeGreen">
          Reopen Window
        </Button>
        <Button onClick={quit} colorScheme="error">
          Shutdown Server
        </Button>
      </BodyFooter>
    </BodyContainer>
  );
});

LaunchFlowWindowCrashed.displayName = 'LaunchFlowWindowCrashed';
