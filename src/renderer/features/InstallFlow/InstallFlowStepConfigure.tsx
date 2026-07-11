import { Button, Divider } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo } from 'react';

import { BodyContainer, BodyContent, BodyFooter, BodyHeader } from '@/renderer/common/layout';
import { InstallFlowStepConfigureCustomIndexUrl } from '@/renderer/features/InstallFlow/InstallFlowStepConfigureCustomIndexUrl';
import { InstallFlowStepConfigureGpuConfirm } from '@/renderer/features/InstallFlow/InstallFlowStepConfigureGpuConfirm';
import { InstallFlowStepper } from '@/renderer/features/InstallFlow/InstallFlowStepper';
import { installFlowApi } from '@/renderer/features/InstallFlow/state';
import { isCustomTorchIndexUrlInvalid } from '@/shared/url';

export const InstallFlowStepConfigure = memo(() => {
  const { gpuType, customTorchIndexUrl } = useStore(installFlowApi.$choices);
  const isNextDisabled = !gpuType || isCustomTorchIndexUrlInvalid(customTorchIndexUrl);
  return (
    <BodyContainer>
      <BodyHeader>
        <InstallFlowStepper />
      </BodyHeader>
      <BodyContent>
        <InstallFlowStepConfigureGpuConfirm />
        <Divider />
        <InstallFlowStepConfigureCustomIndexUrl />
      </BodyContent>
      <BodyFooter>
        <Button onClick={installFlowApi.prevStep} variant="link">
          Back
        </Button>
        <Divider orientation="vertical" />
        <Button onClick={installFlowApi.nextStep} isDisabled={isNextDisabled} colorScheme="invokeYellow">
          Next
        </Button>
      </BodyFooter>
    </BodyContainer>
  );
});
InstallFlowStepConfigure.displayName = 'InstallFlowStepConfigure';
