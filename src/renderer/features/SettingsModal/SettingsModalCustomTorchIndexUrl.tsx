import { Flex, FormControl, FormHelperText, FormLabel, Input } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo, useCallback, useEffect, useState } from 'react';

import { persistedStoreApi } from '@/renderer/services/store';

export const SettingsModalCustomTorchIndexUrl = memo(() => {
  const { customTorchIndexUrl } = useStore(persistedStoreApi.$atom);
  // Keep a local value so typing doesn't round-trip to the store on every keystroke. We persist on blur.
  const [value, setValue] = useState(customTorchIndexUrl ?? '');

  useEffect(() => {
    setValue(customTorchIndexUrl ?? '');
  }, [customTorchIndexUrl]);

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
  }, []);

  const onBlur = useCallback(() => {
    const trimmed = value.trim();
    persistedStoreApi.setKey('customTorchIndexUrl', trimmed === '' ? undefined : trimmed);
  }, [value]);

  return (
    <FormControl orientation="vertical">
      <Flex w="full" alignItems="center" justifyContent="space-between">
        <FormLabel>Custom PyTorch Index URL</FormLabel>
      </Flex>
      <Input value={value} onChange={onChange} onBlur={onBlur} placeholder="https://download.pytorch.org/whl/cu126" />
      <FormHelperText>
        Advanced: overrides the PyTorch index URL from Invoke&apos;s pins for all installs and updates. Use this if the
        default build does not support your GPU (e.g. older Nvidia cards) or for AMD on Windows, where no index is
        provided. The torch version is still pinned by Invoke &ndash; this only changes the build/index. If you set
        this, you are on your own: an invalid URL will break installation. Leave empty to use Invoke&apos;s default.
      </FormHelperText>
    </FormControl>
  );
});
SettingsModalCustomTorchIndexUrl.displayName = 'SettingsModalCustomTorchIndexUrl';
