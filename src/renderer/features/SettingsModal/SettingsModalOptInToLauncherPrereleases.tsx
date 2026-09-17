import { Checkbox, Flex, FormControl, FormHelperText, FormLabel, Icon } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import type { ChangeEvent } from 'react';
import { memo, useCallback } from 'react';
import { PiFlaskFill } from 'react-icons/pi';

import { $isWindowsArm64Build, persistedStoreApi } from '@/renderer/services/store';

export const SettingsModalOptInToLauncherPrereleases = memo(() => {
  const { optInToLauncherPrereleases } = useStore(persistedStoreApi.$atom);
  // The Windows ARM64 build follows its own stable-only update channel; the main process ignores the opt-in there.
  const isWindowsArm64Build = useStore($isWindowsArm64Build);
  const onChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    persistedStoreApi.setKey('optInToLauncherPrereleases', e.target.checked);
  }, []);

  return (
    <FormControl orientation="vertical" isDisabled={isWindowsArm64Build}>
      <Flex w="full" alignItems="center" justifyContent="space-between">
        <FormLabel display="flex" alignItems="center" gap={2}>
          <Icon as={PiFlaskFill} color="invokeYellow.300" />
          Opt-in to Launcher Prereleases
        </FormLabel>
        <Checkbox isChecked={optInToLauncherPrereleases && !isWindowsArm64Build} onChange={onChange} />
      </Flex>
      <FormHelperText>
        {isWindowsArm64Build
          ? 'The Windows ARM64 launcher receives stable releases only; prereleases are published for x64 first.'
          : 'Check for prerelease versions of the launcher on startup. If disabled, the launcher will only check for stable releases.'}
      </FormHelperText>
    </FormControl>
  );
});
SettingsModalOptInToLauncherPrereleases.displayName = 'SettingsModalOptInToLauncherPrereleases';
