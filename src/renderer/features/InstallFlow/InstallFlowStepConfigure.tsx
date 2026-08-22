import { Button, Divider } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { BodyContainer, BodyContent, BodyFooter, BodyHeader } from '@/renderer/common/layout';
import { InstallFlowStepConfigureGpuPicker } from '@/renderer/features/InstallFlow/InstallFlowStepConfigureGpuPicker';
import { InstallFlowStepper } from '@/renderer/features/InstallFlow/InstallFlowStepper';
import { installFlowApi } from '@/renderer/features/InstallFlow/state';

export const InstallFlowStepConfigure = memo(() => {
  const { t } = useTranslation();
  const { gpuType } = useStore(installFlowApi.$choices);
  return (
    <BodyContainer>
      <BodyHeader>
        <InstallFlowStepper />
      </BodyHeader>
      <BodyContent>
        <InstallFlowStepConfigureGpuPicker />
      </BodyContent>
      <BodyFooter>
        <Button onClick={installFlowApi.prevStep} variant="link">
          {t('installFlow.common.back')}
        </Button>
        <Divider orientation="vertical" />
        <Button onClick={installFlowApi.nextStep} isDisabled={!gpuType} colorScheme="invokeYellow">
          {t('installFlow.common.next')}
        </Button>
      </BodyFooter>
    </BodyContainer>
  );
});
InstallFlowStepConfigure.displayName = 'InstallFlowStepConfigure';
