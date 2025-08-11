import { Button } from '@invoke-ai/ui-library';
import { memo, useCallback } from 'react';

import { $isSettingsOpen } from '@/renderer/features/SettingsModal/state';
import { persistedStoreApi } from '@/renderer/services/store';

export const SettingsModalResetButton = memo(() => {
  const onClick = useCallback(() => {
    persistedStoreApi.reset();
    $isSettingsOpen.set(false);
  }, []);
  return (
    <Button size="sm" aria-label="Settings" variant="link" onClick={onClick} colorScheme="error">
      Reset Launcher Settings
    </Button>
  );
});
SettingsModalResetButton.displayName = 'SettingsModalResetButton';
