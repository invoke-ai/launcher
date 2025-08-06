import { Checkbox, Flex, FormControl, FormHelperText, FormLabel } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo, useCallback } from 'react';

import { persistedStoreApi } from '@/renderer/services/store';

export const SettingsModalShowUIWindowMemoryMonitor = memo(() => {
  const { showUIWindowMemoryMonitor } = useStore(persistedStoreApi.$atom);
  const onChange = useCallback(() => {
    persistedStoreApi.setKey('showUIWindowMemoryMonitor', !persistedStoreApi.$atom.get().showUIWindowMemoryMonitor);
  }, []);

  return (
    <FormControl orientation="vertical">
      <Flex w="full" alignItems="center" justifyContent="space-between">
        <FormLabel>Show UI Window Memory Monitor</FormLabel>
        <Checkbox isChecked={showUIWindowMemoryMonitor} onChange={onChange} />
      </Flex>
      <FormHelperText>
        Display memory and CPU usage of the Invoke UI Window in the top-left corner of the app log viewer.
      </FormHelperText>
    </FormControl>
  );
});
SettingsModalShowUIWindowMemoryMonitor.displayName = 'SettingsModalShowUIWindowMemoryMonitor';
