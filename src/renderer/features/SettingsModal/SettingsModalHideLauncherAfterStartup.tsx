import { Checkbox, Flex, FormControl, FormHelperText, FormLabel } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { persistedStoreApi } from '@/renderer/services/store';

export const SettingsModalHideLauncherAfterStartup = memo(() => {
  const { t } = useTranslation();
  const { hideLauncherAfterStartup } = useStore(persistedStoreApi.$atom);
  const onChange = useCallback(() => {
    persistedStoreApi.setKey('hideLauncherAfterStartup', !persistedStoreApi.$atom.get().hideLauncherAfterStartup);
  }, []);

  return (
    <FormControl orientation="vertical">
      <Flex w="full" alignItems="center" justifyContent="space-between">
        <FormLabel>{t('settings.hideLauncherAfterStartup')}</FormLabel>
        <Checkbox isChecked={hideLauncherAfterStartup} onChange={onChange} />
      </Flex>
      <FormHelperText>{t('settings.hideLauncherHelper')}</FormHelperText>
    </FormControl>
  );
});
SettingsModalHideLauncherAfterStartup.displayName = 'SettingsModalHideLauncherAfterStartup';
