import { Button, Divider, Heading, Text } from '@invoke-ai/ui-library';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { BodyContainer, BodyContent, BodyFooter, BodyHeader } from '@/renderer/common/layout';
import { Strong } from '@/renderer/common/Strong';
import { installFlowApi } from '@/renderer/features/InstallFlow/state';
import { selectInstallDir } from '@/renderer/services/store';
import type { DirDetails } from '@/shared/types';

type Props = {
  installDirDetails: Extract<DirDetails, { isInstalled: false }>;
};

export const LaunchFlowInvalidInstall = memo(({ installDirDetails }: Props) => {
  const { t } = useTranslation();
  const install = useCallback(() => {
    installFlowApi.beginFlow(installDirDetails);
  }, [installDirDetails]);

  return (
    <BodyContainer>
      <BodyHeader />
      <BodyContent>
        <Heading>{t('launchFlow.cannotFindInstall')}</Heading>
        <Text fontSize="md">
          {t('launchFlow.noInstallFoundAt')} <Strong>{installDirDetails.path}</Strong>.
        </Text>
      </BodyContent>
      <BodyFooter>
        <Button onClick={selectInstallDir} variant="link">
          {t('launchFlow.switchInstallation')}
        </Button>
        <Divider orientation="vertical" />
        <Button onClick={install} colorScheme="invokeYellow">
          {t('launchFlow.install')}
        </Button>
      </BodyFooter>
    </BodyContainer>
  );
});
LaunchFlowInvalidInstall.displayName = 'LaunchFlowInvalidInstall';
