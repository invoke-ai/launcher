import { Button, Divider, Heading, Link, Text } from '@invoke-ai/ui-library';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { BodyContainer, BodyContent, BodyFooter, BodyHeader } from '@/renderer/common/layout';
import { Strong } from '@/renderer/common/Strong';
import { installFlowApi } from '@/renderer/features/InstallFlow/state';
import { LaunchFlowUpdateCheckerNotification } from '@/renderer/features/LaunchFlow/LaunchFlowUpdateCheckerNotification';
import { startInvoke } from '@/renderer/features/LaunchFlow/state';
import { emitter } from '@/renderer/services/ipc';
import { selectInstallDir } from '@/renderer/services/store';
import type { DirDetails } from '@/shared/types';

type Props = {
  installDirDetails: Extract<DirDetails, { isInstalled: true }>;
};

export const LaunchFlowNotRunning = memo(({ installDirDetails }: Props) => {
  const { t } = useTranslation();
  const launch = useCallback(() => {
    if (!installDirDetails || !installDirDetails.isInstalled) {
      return;
    }
    startInvoke(installDirDetails.path);
  }, [installDirDetails]);

  const install = useCallback(() => {
    installFlowApi.beginFlow(installDirDetails);
  }, [installDirDetails]);

  const openDir = useCallback(() => {
    emitter.invoke('util:open-directory', installDirDetails.path);
  }, [installDirDetails.path]);

  return (
    <BodyContainer>
      <BodyHeader alignItems="flex-end">
        <LaunchFlowUpdateCheckerNotification installDirDetails={installDirDetails} />
      </BodyHeader>
      <BodyContent>
        <Heading>{t('launchFlow.welcomeBack')}</Heading>
        <Text fontSize="md">
          {t('launchFlow.usingPrefix')} <Strong>Invoke {installDirDetails.version}</Strong> {t('launchFlow.usingAt')}{' '}
          <Strong as={Link} onClick={openDir}>
            {installDirDetails.path}
          </Strong>
          .
        </Text>
      </BodyContent>
      <BodyFooter>
        <Button onClick={selectInstallDir} variant="link">
          {t('launchFlow.switchInstallation')}
        </Button>
        <Divider orientation="vertical" />
        <Button onClick={install} variant="link">
          {t('launchFlow.manage')}
        </Button>
        <Divider orientation="vertical" />
        <Button onClick={launch} colorScheme="invokeYellow">
          {t('launchFlow.launch')}
        </Button>
      </BodyFooter>
    </BodyContainer>
  );
});
LaunchFlowNotRunning.displayName = 'LaunchFlowNotRunning';
