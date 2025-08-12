import { Checkbox, Flex, FormControl, FormHelperText, FormLabel, Icon } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import type { ChangeEvent } from 'react';
import { memo, useCallback } from 'react';
import { PiFlaskFill } from 'react-icons/pi';

import { persistedStoreApi } from '@/renderer/services/store';

export const SettingsModalOptInToLauncherPrereleases = memo(() => {
  const { optInToLauncherPrereleases } = useStore(persistedStoreApi.$atom);
  const onChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    persistedStoreApi.setKey('optInToLauncherPrereleases', e.target.checked);
  }, []);

  return (
    <FormControl orientation="vertical">
      <Flex w="full" alignItems="center" justifyContent="space-between">
        <FormLabel display="flex" alignItems="center" gap={2}>
          <Icon as={PiFlaskFill} color="invokeYellow.300" />
          Opt-in to Launcher Prereleases
        </FormLabel>
        <Checkbox isChecked={optInToLauncherPrereleases} onChange={onChange} />
      </Flex>
      <FormHelperText>
        Check for prerelease versions of the launcher on startup. If disabled, the launcher will only check for stable
        releases.
      </FormHelperText>
    </FormControl>
  );
});
SettingsModalOptInToLauncherPrereleases.displayName = 'SettingsModalOptInToLauncherPrereleases';
