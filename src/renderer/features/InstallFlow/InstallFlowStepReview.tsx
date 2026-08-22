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
import { useTranslation } from 'react-i18next';
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
  'nvidia<30xx': 'installFlow.gpuLabel.nvidiaOld',
  'nvidia>=30xx': 'installFlow.gpuLabel.nvidiaNew',
  amd: 'installFlow.gpuLabel.amd',
  nogpu: 'installFlow.gpuLabel.noGpu',
};

export const InstallFlowStepReview = memo(() => {
  const { t } = useTranslation();
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
        <Heading>{t('installFlow.review.title')}</Heading>
        <UnorderedList styleType="'-'">
          <ListItem>
            <InstallFlowInstallTypeDescription installType={installType} />
          </ListItem>
          {release.type === 'gh' && release.isPrerelease && (
            <ListItem>
              <Text fontSize="md">
                {t('installFlow.review.prereleasePrefix')} <Strong>{t('installFlow.review.prereleaseStrong')}</Strong>{t('installFlow.review.prereleaseSuffix')}
              </Text>
            </ListItem>
          )}
          {release.type === 'gh' && !release.isPrerelease && (
            <ListItem>
              <Text fontSize="md">
                {t('installFlow.review.stablePrefix')} <Strong>{t('installFlow.review.stableStrong')}</Strong>{t('installFlow.review.stableSuffix')}
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
              {t('installFlow.review.youHavePrefix')} <Strong>{t(GPU_LABEL_MAP[gpuType])}.</Strong>
            </Text>
          </ListItem>
        </UnorderedList>
        <Spacer />
      </BodyContent>
      <BodyFooter>
        <Tooltip
          label={
            <Flex flexDir="column" gap={1}>
              <Text fontWeight="semibold">{t('installFlow.review.repairModeTitle')}</Text>
              <Text>{t('installFlow.review.repairModeBody')}</Text>
            </Flex>
          }
        >
          <FormControl w="min-content">
            <FormLabel m={0} fontWeight="normal" fontSize="md">
              {t('installFlow.review.repairMode')}
            </FormLabel>
            <Checkbox isChecked={repairMode} onChange={onChangeRepairMode} />
          </FormControl>
        </Tooltip>
        <Divider orientation="vertical" />
        <Button onClick={installFlowApi.prevStep} variant="link">
          {t('installFlow.common.back')}
        </Button>
        <Divider orientation="vertical" />
        <Button w={24} onClick={installFlowApi.startInstall} colorScheme="invokeYellow">
          {t('installFlow.common.install')}
        </Button>
      </BodyFooter>
    </BodyContainer>
  );
});
InstallFlowStepReview.displayName = 'InstallFlowStepReview';
