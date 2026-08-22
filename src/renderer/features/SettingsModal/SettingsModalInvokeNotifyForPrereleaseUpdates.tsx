import { Checkbox, Flex, FormControl, FormHelperText, FormLabel, Icon } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo, useCallback } from 'react';
import { PiFlaskFill } from 'react-icons/pi';
import { useTranslation } from 'react-i18next';

import { persistedStoreApi } from '@/renderer/services/store';

export const SettingsModalInvokeNotifyForPrereleaseUpdates = memo(() => {
  const { t } = useTranslation();
  const { notifyForPrereleaseUpdates } = useStore(persistedStoreApi.$atom);
  const onChange = useCallback(() => {
    persistedStoreApi.setKey('notifyForPrereleaseUpdates', !persistedStoreApi.$atom.get().notifyForPrereleaseUpdates);
  }, []);

  return (
    <FormControl orientation="vertical">
      <Flex w="full" alignItems="center" justifyContent="space-between">
        <FormLabel display="flex" alignItems="center" gap={2}>
          <Icon as={PiFlaskFill} color="invokeYellow.300" />
          {t('settings.notifyForPrereleaseUpdates')}
        </FormLabel>
        <Checkbox isChecked={notifyForPrereleaseUpdates} onChange={onChange} />
      </Flex>
      <FormHelperText>{t('settings.notifyHelper')}</FormHelperText>
    </FormControl>
  );
});
SettingsModalInvokeNotifyForPrereleaseUpdates.displayName = 'SettingsModalNotifyForPrereleaseUpdates';
