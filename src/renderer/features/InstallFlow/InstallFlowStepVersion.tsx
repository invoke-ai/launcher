import { Button, Divider } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { valid } from '@renovatebot/pep440';
import { memo } from 'react';

import { BodyContainer, BodyContent, BodyFooter, BodyHeader } from '@/renderer/common/layout';
import { InstallFlowStepper } from '@/renderer/features/InstallFlow/InstallFlowStepper';
import { InstallFlowStepVersionVersionPicker } from '@/renderer/features/InstallFlow/InstallFlowStepVersionVersionPicker';
import { installFlowApi } from '@/renderer/features/InstallFlow/state';

export const InstallFlowStepVersion = memo(() => {
  const { release } = useStore(installFlowApi.$choices);

  return (
    <BodyContainer>
      <BodyHeader>
        <InstallFlowStepper />
      </BodyHeader>
      <BodyContent>
        <InstallFlowStepVersionVersionPicker />
      </BodyContent>
      <BodyFooter>
        <Button onClick={installFlowApi.prevStep} variant="link">
          Back
        </Button>
        <Divider orientation="vertical" />
        <Button
          onClick={installFlowApi.nextStep}
          isDisabled={!release || valid(release.version) === null}
          colorScheme="invokeYellow"
        >
          Next
        </Button>
      </BodyFooter>
    </BodyContainer>
  );
});
InstallFlowStepVersion.displayName = 'InstallFlowStepVersion';
