import { Button, Divider, Heading, ListItem, Text, UnorderedList, useShiftModifier } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo } from 'react';
import { assert } from 'tsafe';

import { BodyContainer, BodyContent, BodyFooter, BodyHeader } from '@/renderer/common/layout';
import { Strong } from '@/renderer/common/Strong';
import { InstallFlowInstallTypeDescription } from '@/renderer/features/InstallFlow/InstallFlowInstallTypeDescription';
import { InstallFlowStepper } from '@/renderer/features/InstallFlow/InstallFlowStepper';
import { installFlowApi } from '@/renderer/features/InstallFlow/state';
import type { GpuType } from '@/shared/types';

const GPU_LABEL_MAP: Record<GpuType, string> = {
  'nvidia<30xx': 'a Nvidia 20xx or older GPU',
  'nvidia>=30xx': 'a Nvidia 30xx or newer GPU',
  amd: 'an AMD GPU',
  nogpu: 'no GPU',
};

export const InstallFlowStepReview = memo(() => {
  const { dirDetails, gpuType, release } = useStore(installFlowApi.$choices);
  const installType = useStore(installFlowApi.$installType);

  const shift = useShiftModifier();

  assert(dirDetails !== null);
  assert(gpuType !== null);
  assert(release !== null);
  assert(installType !== null);

  return (
    <BodyContainer>
      <BodyHeader>
        <InstallFlowStepper />
      </BodyHeader>
      <BodyContent>
        <Heading>Review installation.</Heading>
        <UnorderedList styleType="'-'">
          <ListItem>
            <InstallFlowInstallTypeDescription installType={installType} />
          </ListItem>
          {release.isPrerelease && (
            <ListItem>
              <Text fontSize="md">
                This is a <Strong>prerelease</Strong> of Invoke. Thanks for helping us test it!
              </Text>
            </ListItem>
          )}
          {!release.isPrerelease && (
            <ListItem>
              <Text fontSize="md">
                This is a <Strong>stable</Strong> release of Invoke.
              </Text>
            </ListItem>
          )}
          <ListItem>
            <Text fontSize="md">
              You have <Strong>{GPU_LABEL_MAP[gpuType]}.</Strong>
            </Text>
          </ListItem>
        </UnorderedList>
      </BodyContent>
      <BodyFooter>
        <Button onClick={installFlowApi.prevStep} variant="link">
          Back
        </Button>
        <Divider orientation="vertical" />
        {shift && (
          <Button onClick={installFlowApi.startInstallWithRepair} colorScheme="invokeRed">
            Repair
          </Button>
        )}
        {!shift && (
          <Button onClick={installFlowApi.startInstallWithoutRepair} colorScheme="invokeYellow">
            Install
          </Button>
        )}
      </BodyFooter>
    </BodyContainer>
  );
});
InstallFlowStepReview.displayName = 'InstallFlowStepReview';
