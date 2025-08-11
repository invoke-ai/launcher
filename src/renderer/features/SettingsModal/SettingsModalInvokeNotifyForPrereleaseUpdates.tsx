import { Checkbox, Flex, FormControl, FormHelperText, FormLabel, Icon } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo, useCallback } from 'react';
import { PiFlaskFill } from 'react-icons/pi';

import { persistedStoreApi } from '@/renderer/services/store';

export const SettingsModalInvokeNotifyForPrereleaseUpdates = memo(() => {
  const { notifyForPrereleaseUpdates } = useStore(persistedStoreApi.$atom);
  const onChange = useCallback(() => {
    persistedStoreApi.setKey('notifyForPrereleaseUpdates', !persistedStoreApi.$atom.get().notifyForPrereleaseUpdates);
  }, []);

  return (
    <FormControl orientation="vertical">
      <Flex w="full" alignItems="center" justifyContent="space-between">
        <FormLabel display="flex" alignItems="center" gap={2}>
          <Icon as={PiFlaskFill} color="invokeYellow.300" />
          Notify for Invoke Prerelease Updates
        </FormLabel>
        <Checkbox isChecked={notifyForPrereleaseUpdates} onChange={onChange} />
      </Flex>
      <FormHelperText>
        Show a notification when a prerelease version of Invoke is available. Even if this is disabled, you&apos;ll
        still be able to choose to install a prerelease version when updating or installing Invoke.
      </FormHelperText>
    </FormControl>
  );
});
SettingsModalInvokeNotifyForPrereleaseUpdates.displayName = 'SettingsModalNotifyForPrereleaseUpdates';
