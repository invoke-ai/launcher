import { Checkbox, Flex, FormControl, FormHelperText, FormLabel } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { persistedStoreApi } from '@/renderer/services/store';

export const SettingsModalInvokeServerMode = memo(() => {
  const { t } = useTranslation();
  const { serverMode } = useStore(persistedStoreApi.$atom);
  const onChange = useCallback(() => {
    persistedStoreApi.setKey('serverMode', !persistedStoreApi.$atom.get().serverMode);
  }, []);

  return (
    <FormControl orientation="vertical">
      <Flex w="full" alignItems="center" justifyContent="space-between">
        <FormLabel>{t('settings.serverMode')}</FormLabel>
        <Checkbox isChecked={serverMode} onChange={onChange} />
      </Flex>
      <FormHelperText>{t('settings.serverModeHelper')}</FormHelperText>
    </FormControl>
  );
});
SettingsModalInvokeServerMode.displayName = 'SettingsModalInvokeServerMode';
