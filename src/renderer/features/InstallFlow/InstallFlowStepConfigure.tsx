import { Button, Divider } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo } from 'react';

import { BodyContainer, BodyContent, BodyFooter, BodyHeader } from '@/renderer/common/layout';
import { useSystemInfo } from '@/renderer/contexts/SystemInfoContext';
import { InstallFlowStepConfigureCustomIndexUrl } from '@/renderer/features/InstallFlow/InstallFlowStepConfigureCustomIndexUrl';
import { InstallFlowStepConfigureGpuConfirm } from '@/renderer/features/InstallFlow/InstallFlowStepConfigureGpuConfirm';
import { InstallFlowStepper } from '@/renderer/features/InstallFlow/InstallFlowStepper';
import { installFlowApi } from '@/renderer/features/InstallFlow/state';
import { isCustomTorchIndexUrlInvalid } from '@/shared/url';

export const InstallFlowStepConfigure = memo(() => {
  const { gpuType, customTorchIndexUrl } = useStore(installFlowApi.$choices);
  const { operatingSystem } = useSystemInfo();
  // There is no macOS wheel on any PyTorch device index - macOS torch comes from PyPI and uses MPS - so an override
  // there can only ever fail to resolve. Don't offer the field rather than letting someone paste the placeholder.
  const isCustomIndexSupported = operatingSystem !== 'macOS';
  const isNextDisabled = !gpuType || isCustomTorchIndexUrlInvalid(customTorchIndexUrl);
  return (
    <BodyContainer>
      <BodyHeader>
        <InstallFlowStepper />
      </BodyHeader>
      <BodyContent>
        <InstallFlowStepConfigureGpuConfirm />
        {isCustomIndexSupported && (
          <>
            <Divider />
            <InstallFlowStepConfigureCustomIndexUrl />
          </>
        )}
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
