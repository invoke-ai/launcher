import { Button, ButtonGroup, Divider, Heading, Text } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { PiFolderOpenBold } from 'react-icons/pi';
import type { Equals } from 'tsafe';
import { assert } from 'tsafe';

import { ButtonWithTruncatedLabel } from '@/renderer/common/ButtonWithTruncatedLabel';
import { BodyContainer, BodyContent, BodyFooter, BodyHeader } from '@/renderer/common/layout';
import { Strong } from '@/renderer/common/Strong';
import { InstallFlowStepper } from '@/renderer/features/InstallFlow/InstallFlowStepper';
import { installFlowApi } from '@/renderer/features/InstallFlow/state';
import { emitter } from '@/renderer/services/ipc';

const selectInstallDir = async () => {
  const { dirDetails } = installFlowApi.$choices.get();
  const dir = await emitter.invoke('util:select-directory', dirDetails?.path);
  if (!dir) {
    return;
  }
  const details = await emitter.invoke('util:get-dir-details', dir);
  installFlowApi.$choices.setKey('dirDetails', details);
};

export const InstallFlowStepLocation = memo(() => {
  const { t } = useTranslation();
  const { dirDetails } = useStore(installFlowApi.$choices);

  return (
    <BodyContainer>
      <BodyHeader>
        <InstallFlowStepper />
      </BodyHeader>
      <BodyContent>
        <StepHeading />
        <ButtonGroup isAttached={false}>
          <ButtonWithTruncatedLabel variant="ghost" onClick={selectInstallDir} rightIcon={<PiFolderOpenBold />}>
            {dirDetails?.path ?? t('installFlow.location.choose')}
          </ButtonWithTruncatedLabel>
        </ButtonGroup>
        {dirDetails && dirDetails.canInstall && dirDetails.isInstalled && (
          <Text fontSize="md">
            {t('installFlow.location.dataRetainedPrefix')} <Strong>{t('installFlow.location.dataRetainedStrong')}</Strong>
          </Text>
        )}
        {dirDetails && dirDetails.canInstall && !dirDetails.isInstalled && (
          <Text fontSize="md">{t('installFlow.location.brokenInstall')}</Text>
        )}
        {dirDetails && !dirDetails.canInstall && !dirDetails.isDirectory && (
          <Text fontSize="md">{t('installFlow.location.notDirectory')}</Text>
        )}
      </BodyContent>
      <BodyFooter>
        <Button onClick={installFlowApi.cancelFlow} variant="link">
          {t('installFlow.common.cancel')}
        </Button>
        <Divider orientation="vertical" />
        <Button
          onClick={installFlowApi.nextStep}
          isDisabled={!dirDetails || !dirDetails.canInstall}
          colorScheme="invokeYellow"
        >
          {t('installFlow.common.next')}
        </Button>
      </BodyFooter>
    </BodyContainer>
  );
});
InstallFlowStepLocation.displayName = 'InstallFlowStepLocation';

const StepHeading = memo(() => {
  const { t } = useTranslation();
  const { dirDetails } = useStore(installFlowApi.$choices);

  if (!dirDetails) {
    return <Heading>{t('installFlow.location.whereTitle')}</Heading>;
  }
  if (!dirDetails.canInstall) {
    return <Heading>{t('installFlow.location.invalidTitle')}</Heading>;
  }
  if (dirDetails.canInstall && !dirDetails.isInstalled) {
    return <Heading>{t('installFlow.location.freshTitle')}</Heading>;
  }
  if (dirDetails.canInstall && dirDetails.isInstalled) {
    return <Heading>{t('installFlow.location.existingTitle', { version: dirDetails.version })}</Heading>;
  }
  assert<Equals<typeof dirDetails, never>>(dirDetails, 'This should never happen');
});
StepHeading.displayName = 'StepHeading';
