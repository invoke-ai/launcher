import { Checkbox, Flex, FormControl, FormHelperText, FormLabel } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo, useCallback } from 'react';

import { persistedStoreApi } from '@/renderer/services/store';

export const SettingsModalHideLauncherAfterStartup = memo(() => {
  const { hideLauncherAfterStartup } = useStore(persistedStoreApi.$atom);
  const onChange = useCallback(() => {
    persistedStoreApi.setKey('hideLauncherAfterStartup', !persistedStoreApi.$atom.get().hideLauncherAfterStartup);
  }, []);

  return (
    <FormControl orientation="vertical">
      <Flex w="full" alignItems="center" justifyContent="space-between">
        <FormLabel>Hide Launcher After Startup</FormLabel>
        <Checkbox isChecked={hideLauncherAfterStartup} onChange={onChange} />
      </Flex>
      <FormHelperText>
        Once Invoke has started, hide the launcher to the system tray. Click the tray icon to bring it back to view the
        logs. The launcher reappears if Invoke crashes and closes when Invoke shuts down normally.
      </FormHelperText>
    </FormControl>
  );
});
SettingsModalHideLauncherAfterStartup.displayName = 'SettingsModalHideLauncherAfterStartup';
