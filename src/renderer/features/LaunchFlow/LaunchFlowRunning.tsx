import { Button, Heading, Text, VStack } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BodyContainer, BodyContent, BodyFooter } from '@/renderer/common/layout';
import { LaunchFlowLogViewer } from '@/renderer/features/LaunchFlow/LaunchFlowLogViewer';
import {
  $invokeProcessStatus,
  $isInvokeProcessPendingDismissal,
  teardownTerminal,
} from '@/renderer/features/LaunchFlow/state';
import { emitter } from '@/renderer/services/ipc';
import { persistedStoreApi } from '@/renderer/services/store';

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

const restartWindow = async () => {
  await emitter.invoke('invoke-process:restart-window');
};

export const LaunchFlowRunning = memo(() => {
  const { t } = useTranslation();
  const invokeProcessStatus = useStore($invokeProcessStatus);
  const isInvokeProcessPendingDismissal = useStore($isInvokeProcessPendingDismissal);
  const { serverMode } = useStore(persistedStoreApi.$atom);
  const [isRestartingWindow, setIsRestartingWindow] = useState(false);
  const canRestartWindow = invokeProcessStatus.type === 'running' && !serverMode;

  const restart = useCallback(async () => {
    setIsRestartingWindow(true);
    try {
      await restartWindow();
    } finally {
      setIsRestartingWindow(false);
    }
  }, []);

  return (
    <BodyContainer>
      <BodyContent>
        {invokeProcessStatus.type === 'window-crashed' && (
          <VStack gap={4} alignItems="center" justifyContent="center" h="full">
            <Heading size="lg">{t('launchFlow.windowCrashed')}</Heading>
            <Text color="base.300">{t('launchFlow.windowCrashedHelper')}</Text>
            <Text color="base.300">{t('launchFlow.windowCrashedAction')}</Text>
          </VStack>
        )}
        <LaunchFlowLogViewer />
      </BodyContent>
      <BodyFooter>
        {isInvokeProcessPendingDismissal && (
          <Button variant="ghost" onClick={dismissPostInvoke}>
            {t('launchFlow.back')}
          </Button>
        )}
        {!isInvokeProcessPendingDismissal && canRestartWindow && (
          <>
            <Button
              onClick={restart}
              isLoading={isRestartingWindow}
              loadingText={t('launchFlow.restarting')}
              isDisabled={isRestartingWindow}
              colorScheme="invokeGreen"
            >
              {t('launchFlow.restartWindow')}
            </Button>
            <Button onClick={quit} isDisabled={isRestartingWindow} colorScheme="error">
              {t('launchFlow.shutdown')}
            </Button>
          </>
        )}
        {!isInvokeProcessPendingDismissal && !canRestartWindow && invokeProcessStatus.type !== 'window-crashed' && (
          <Button
            onClick={quit}
            isLoading={invokeProcessStatus.type === 'exiting'}
            loadingText={t('launchFlow.shuttingDown')}
            colorScheme="error"
          >
            {t('launchFlow.shutdown')}
          </Button>
        )}
        {!isInvokeProcessPendingDismissal && invokeProcessStatus.type === 'window-crashed' && (
          <Button onClick={reopenWindow} colorScheme="invokeGreen">
            {t('launchFlow.reopenWindow')}
          </Button>
        )}
        {!isInvokeProcessPendingDismissal && invokeProcessStatus.type === 'window-crashed' && (
          <Button onClick={quit} colorScheme="error">
            {t('launchFlow.shutdownServer')}
          </Button>
        )}
      </BodyFooter>
    </BodyContainer>
  );
});

LaunchFlowRunning.displayName = 'LaunchFlowRunning';
