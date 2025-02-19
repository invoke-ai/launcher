import { Checkbox, Flex, FormControl, FormHelperText, FormLabel } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import type { ChangeEvent } from 'react';
import { memo, useCallback } from 'react';

import { persistedStoreApi } from '@/renderer/services/store';

export const SettingsModalNotifyForPrereleaseUpdates = memo(() => {
  const { notifyForPrereleaseUpdates } = useStore(persistedStoreApi.$atom);
  const onChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    persistedStoreApi.setKey('notifyForPrereleaseUpdates', e.target.checked);
  }, []);

  return (
    <FormControl orientation="vertical">
      <Flex w="full" alignItems="center" justifyContent="space-between">
        <FormLabel>Notify for Prerelease Updates</FormLabel>
        <Checkbox isChecked={notifyForPrereleaseUpdates} onChange={onChange} />
      </Flex>
      <FormHelperText>
        When enabled, when a prerelease update is available, we&apos;ll display a notification within the launcher.
      </FormHelperText>
      <FormHelperText>When disabled, we&apos;ll only display the notification for stable releases.</FormHelperText>
      <FormHelperText>
        If there is a prerelease available, you&apos;ll always be able to select it while installing or updating.
      </FormHelperText>
    </FormControl>
  );
});
SettingsModalNotifyForPrereleaseUpdates.displayName = 'SettingsModalNotifyForPrereleaseUpdates';
