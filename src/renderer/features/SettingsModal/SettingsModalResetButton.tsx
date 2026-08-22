import { Button } from '@invoke-ai/ui-library';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { $isSettingsOpen } from '@/renderer/features/SettingsModal/state';
import { persistedStoreApi } from '@/renderer/services/store';

export const SettingsModalResetButton = memo(() => {
  const { t } = useTranslation();
  const onClick = useCallback(() => {
    persistedStoreApi.reset();
    $isSettingsOpen.set(false);
  }, []);
  return (
    <Button size="sm" aria-label="Settings" variant="link" onClick={onClick} colorScheme="error">
      {t('common.reset')}
    </Button>
  );
});
SettingsModalResetButton.displayName = 'SettingsModalResetButton';
