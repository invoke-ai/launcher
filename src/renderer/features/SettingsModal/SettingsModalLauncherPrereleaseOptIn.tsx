import { Checkbox, Flex, FormControl, FormHelperText, FormLabel, Icon } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import type { ChangeEvent } from 'react';
import { memo, useCallback } from 'react';
import { PiFlaskFill } from 'react-icons/pi';

import { persistedStoreApi } from '@/renderer/services/store';

export const SettingsModalLauncherPrerelease = memo(() => {
  const { launcherPrerelease } = useStore(persistedStoreApi.$atom);
  const onChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    persistedStoreApi.setKey('launcherPrerelease', e.target.checked);
  }, []);

  return (
    <FormControl orientation="vertical">
      <Flex w="full" alignItems="center" justifyContent="space-between">
        <FormLabel display="flex" alignItems="center" gap={2}>
          <Icon as={PiFlaskFill} color="invokeYellow.300" />
          Opt-in to Launcher Prerelease Updates
        </FormLabel>
        <Checkbox isChecked={launcherPrerelease} onChange={onChange} />
      </Flex>
      <FormHelperText>
        Install Launcher prerelease versions when available. Enable if you want to help test the Launcher.
      </FormHelperText>
    </FormControl>
  );
});
SettingsModalLauncherPrerelease.displayName = 'SettingsModalLauncherPrerelease';
