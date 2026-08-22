import { Button, Divider, Heading, Text } from '@invoke-ai/ui-library';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { BodyContainer, BodyContent, BodyFooter, BodyHeader } from '@/renderer/common/layout';
import { installFlowApi } from '@/renderer/features/InstallFlow/state';
import { selectInstallDir } from '@/renderer/services/store';

export const FirstRun = memo(() => {
  const { t } = useTranslation();
  const install = useCallback(() => {
    installFlowApi.beginFlow();
  }, []);

  return (
    <BodyContainer>
      <BodyHeader />
      <BodyContent>
        <Heading>{t('firstRun.welcome')}</Heading>
        <Text fontSize="md">{t('firstRun.installOrSelect')}</Text>
      </BodyContent>
      <BodyFooter>
        <Button onClick={selectInstallDir} variant="link">
          {t('firstRun.selectExisting')}
        </Button>
        <Divider orientation="vertical" />
        <Button onClick={install} colorScheme="invokeYellow">
          {t('firstRun.install')}
        </Button>
      </BodyFooter>
    </BodyContainer>
  );
});
FirstRun.displayName = 'FirstRun';
