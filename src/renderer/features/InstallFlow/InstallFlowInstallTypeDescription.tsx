import { Text } from '@invoke-ai/ui-library';
import { valid } from '@renovatebot/pep440';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { Strong } from '@/renderer/common/Strong';
import type { InstallType } from '@/shared/types';

type Props = {
  installType: InstallType;
};

export const InstallFlowInstallTypeDescription = memo(({ installType }: Props) => {
  const { t } = useTranslation();
  if (installType.type === 'fresh') {
    return (
      <Text fontSize="md">
        {t('installFlow.installType.freshPrefix')} <Strong>Invoke {installType.newVersion}</Strong>{t('installFlow.installType.freshSuffix')}
      </Text>
    );
  }
  if (installType.type === 'reinstall') {
    return (
      <Text fontSize="md">
        {t('installFlow.installType.reinstallPrefix')} <Strong>Invoke {installType.installedVersion}</Strong>{t('installFlow.installType.reinstallSuffix')}
      </Text>
    );
  }
  if (installType.type === 'upgrade') {
    return (
      <Text fontSize="md">
        {t('installFlow.installType.upgradePrefix')} <Strong>Invoke {installType.installedVersion}</Strong>{t('installFlow.installType.upgradeMiddle')} <Strong>{installType.newVersion}</Strong>{t('installFlow.installType.upgradeSuffix')}
      </Text>
    );
  }
  if (installType.type === 'downgrade') {
    return (
      <Text fontSize="md">
        {t('installFlow.installType.downgradePrefix')} <Strong>Invoke {installType.installedVersion}</Strong>{t('installFlow.installType.downgradeMiddle')} <Strong>{installType.newVersion}</Strong>{t('installFlow.installType.downgradeSuffix')}
      </Text>
    );
  }
  if (installType.type === 'manual') {
    const isValid = valid(installType.newVersion) !== null;

    if (!isValid) {
      return <></>;
    }

    return (
      <Text fontSize="md">
        {t('installFlow.installType.manualPrefix')} <Strong>{installType.newVersion}</Strong>{t('installFlow.installType.manualMiddle')} <Strong>Invoke {installType.installedVersion}</Strong>{t('installFlow.installType.manualSuffix')}
      </Text>
    );
  }
});

InstallFlowInstallTypeDescription.displayName = 'InstallFlowInstallTypeDescription';

export const ManualVersionWarning = memo(() => {
  const { t } = useTranslation();
  return (
    <Text fontSize="md" color="warning.300" fontWeight="semibold">
      {t('installFlow.installType.manualWarning')}
    </Text>
  );
});
ManualVersionWarning.displayName = 'ManualVersionWarning';
