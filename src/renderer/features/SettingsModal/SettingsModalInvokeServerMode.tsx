import { Checkbox, Flex, FormControl, FormHelperText, FormLabel } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo, useCallback } from 'react';

import { persistedStoreApi } from '@/renderer/services/store';

export const SettingsModalInvokeServerMode = memo(() => {
  const { serverMode } = useStore(persistedStoreApi.$atom);
  const onChange = useCallback(() => {
    persistedStoreApi.setKey('serverMode', !persistedStoreApi.$atom.get().serverMode);
  }, []);

  return (
    <FormControl orientation="vertical">
      <Flex w="full" alignItems="center" justifyContent="space-between">
        <FormLabel>Server Mode</FormLabel>
        <Checkbox isChecked={serverMode} onChange={onChange} />
      </Flex>
      <FormHelperText>
        Run Invoke in &quot;headless&quot; mode with no UI. You can access Invoke on any computer on your local network
        at the displayed URL.
      </FormHelperText>
    </FormControl>
  );
});
SettingsModalInvokeServerMode.displayName = 'SettingsModalInvokeServerMode';
