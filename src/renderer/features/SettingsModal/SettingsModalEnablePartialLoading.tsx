import { Checkbox, Flex, FormControl, FormHelperText, FormLabel } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import type { ChangeEvent } from 'react';
import { memo, useCallback } from 'react';

import { persistedStoreApi } from '@/renderer/services/store';

export const SettingsModalEnablePartialLoading = memo(() => {
  const { enablePartialLoading } = useStore(persistedStoreApi.$atom);
  const onChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    persistedStoreApi.setKey('enablePartialLoading', e.target.checked);
  }, []);

  return (
    <FormControl orientation="vertical">
      <Flex w="full" alignItems="center" justifyContent="space-between">
        <FormLabel>Enable Partial Loading</FormLabel>
        <Checkbox isChecked={enablePartialLoading} onChange={onChange} />
      </Flex>
      <FormHelperText>
        When loading models, if it won&apos;t fit in the available VRAM, it will be loaded by layer. This prevents out
        of memory errors at the cost of generation speed.
      </FormHelperText>
      <FormHelperText>
        When disabled, if a model will not fit in VRAM, you will get an out of memory error.
      </FormHelperText>
    </FormControl>
  );
});
SettingsModalEnablePartialLoading.displayName = 'SettingsModalEnablePartialLoading';
