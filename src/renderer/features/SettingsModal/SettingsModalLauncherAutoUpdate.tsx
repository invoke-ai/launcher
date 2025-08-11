import { Checkbox, Flex, FormControl, FormHelperText, FormLabel } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import type { ChangeEvent } from 'react';
import { memo, useCallback } from 'react';

import { persistedStoreApi } from '@/renderer/services/store';

export const SettingsModalLauncherAutoUpdate = memo(() => {
  const { launcherAutoUpdate } = useStore(persistedStoreApi.$atom);
  const onChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    persistedStoreApi.setKey('launcherAutoUpdate', e.target.checked);
  }, []);

  return (
    <FormControl orientation="vertical">
      <Flex w="full" alignItems="center" justifyContent="space-between">
        <FormLabel>Update Launcher Automatically</FormLabel>
        <Checkbox isChecked={launcherAutoUpdate} onChange={onChange} />
      </Flex>
      <FormHelperText>Automatically download and install Launcher updates.</FormHelperText>
    </FormControl>
  );
});
SettingsModalLauncherAutoUpdate.displayName = 'SettingsModalLauncherAutoUpdate';
