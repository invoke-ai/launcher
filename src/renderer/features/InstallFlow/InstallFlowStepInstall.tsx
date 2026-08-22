import { Button } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { BodyContainer, BodyContent, BodyFooter, BodyHeader } from '@/renderer/common/layout';
import { InstallFlowLogs } from '@/renderer/features/InstallFlow/InstallFlowLogs';
import { InstallFlowStepper } from '@/renderer/features/InstallFlow/InstallFlowStepper';
import {
  $installProcessStatus,
  getIsActiveInstallProcessStatus,
  installFlowApi,
} from '@/renderer/features/InstallFlow/state';

export const InstallFlowStepInstall = memo(() => {
  const { t } = useTranslation();
  const installProcessStatus = useStore($installProcessStatus);
  const isFinished = useStore(installFlowApi.$isFinished);

  const isActive = getIsActiveInstallProcessStatus(installProcessStatus);

  return (
    <BodyContainer>
      <BodyHeader h="min-content">
        <InstallFlowStepper />
      </BodyHeader>
      <BodyContent>
        <InstallFlowLogs />
      </BodyContent>
      <BodyFooter>
        {isActive && (
          <Button
            onClick={installFlowApi.cancelInstall}
            isLoading={installProcessStatus.type === 'canceling'}
            colorScheme="error"
            loadingText={t('installFlow.common.canceling')}
          >
            {t('installFlow.common.cancel')}
          </Button>
        )}
        {!isActive && isFinished && (
          <Button colorScheme="invokeYellow" onClick={installFlowApi.finalizeInstall}>
            {t('installFlow.common.finish')}
          </Button>
        )}
      </BodyFooter>
    </BodyContainer>
  );
});
InstallFlowStepInstall.displayName = 'InstallFlowStepInstall';
