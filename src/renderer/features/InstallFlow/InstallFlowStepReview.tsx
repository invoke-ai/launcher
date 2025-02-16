import {
  Button,
  Checkbox,
  Divider,
  Flex,
  FormControl,
  FormLabel,
  Heading,
  ListItem,
  Spacer,
  Text,
  Tooltip,
  UnorderedList,
} from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import type { ChangeEvent } from 'react';
import { memo, useCallback } from 'react';
import { assert } from 'tsafe';

import { BodyContainer, BodyContent, BodyFooter, BodyHeader } from '@/renderer/common/layout';
import { Strong } from '@/renderer/common/Strong';
import {
  InstallFlowInstallTypeDescription,
  ManualVersionWarning,
} from '@/renderer/features/InstallFlow/InstallFlowInstallTypeDescription';
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
  const { dirDetails, gpuType, release, repairMode } = useStore(installFlowApi.$choices);
  const installType = useStore(installFlowApi.$installType);

  const onChangeRepairMode = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    installFlowApi.$choices.set({ ...installFlowApi.$choices.get(), repairMode: e.target.checked });
  }, []);

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
          {release.type === 'gh' && release.isPrerelease && (
            <ListItem>
              <Text fontSize="md">
                This is a <Strong>prerelease</Strong> of Invoke. Thanks for helping us test it!
              </Text>
            </ListItem>
          )}
          {release.type === 'gh' && !release.isPrerelease && (
            <ListItem>
              <Text fontSize="md">
                This is a <Strong>stable</Strong> release of Invoke.
              </Text>
            </ListItem>
          )}
          {release.type === 'manual' && (
            <ListItem>
              <ManualVersionWarning />
            </ListItem>
          )}
          <ListItem>
            <Text fontSize="md">
              You have <Strong>{GPU_LABEL_MAP[gpuType]}.</Strong>
            </Text>
          </ListItem>
        </UnorderedList>
        <Spacer />
      </BodyContent>
      <BodyFooter>
        <Tooltip
          label={
            <Flex flexDir="column" gap={1}>
              <Text fontWeight="semibold">Repair mode can fix installation or update issues.</Text>
              <Text>It reinstalls python and recreates the virtual environment.</Text>
            </Flex>
          }
        >
          <FormControl w="min-content">
            <FormLabel m={0} fontWeight="normal" fontSize="md">
              Repair mode
            </FormLabel>
            <Checkbox isChecked={repairMode} onChange={onChangeRepairMode} />
          </FormControl>
        </Tooltip>
        <Divider orientation="vertical" />
        <Button onClick={installFlowApi.prevStep} variant="link">
          Back
        </Button>
        <Divider orientation="vertical" />
        <Button w={24} onClick={installFlowApi.startInstall} colorScheme="invokeYellow">
          Install
        </Button>
      </BodyFooter>
    </BodyContainer>
  );
});
InstallFlowStepReview.displayName = 'InstallFlowStepReview';
