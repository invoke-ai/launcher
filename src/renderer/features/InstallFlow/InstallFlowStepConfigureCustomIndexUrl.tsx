import { Flex, FormControl, FormLabel, Heading, Input, Text, Tooltip } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import type { ChangeEvent } from 'react';
import { memo, useCallback } from 'react';

import { installFlowApi } from '@/renderer/features/InstallFlow/state';

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * A custom torch index URL is optional. When set, it must be a valid http(s) URL. Anything else (typos like
 * `htps://...`, a bare `cu126`, etc.) is rejected at entry so it doesn't surface minutes into an install as a
 * cryptic uv resolver error.
 */
export const isCustomTorchIndexUrlInvalid = (value: string): boolean => {
  const trimmed = value.trim();
  return trimmed.length > 0 && !isHttpUrl(trimmed);
};

export const InstallFlowStepConfigureCustomIndexUrl = memo(() => {
  const { customTorchIndexUrl } = useStore(installFlowApi.$choices);

  const onChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    installFlowApi.$choices.setKey('customTorchIndexUrl', e.target.value);
  }, []);

  const isInvalid = isCustomTorchIndexUrlInvalid(customTorchIndexUrl);

  return (
    <Flex flexDir="column" gap={2} w="full" maxW={96} alignItems="center">
      <Heading size="sm">Custom PyTorch index (optional)</Heading>
      <Tooltip
        label={
          <Flex flexDir="column" gap={1}>
            <Text fontWeight="semibold">Override the PyTorch index for this installation.</Text>
            <Text>
              Leave empty to use Invoke&apos;s defaults. When set, torch is installed from this index instead. Useful
              for e.g. cu126 on 20xx-series cards or ROCm on Windows. You are on your own with this override.
            </Text>
          </Flex>
        }
      >
        <FormControl isInvalid={isInvalid} flexDir="column" gap={1}>
          <FormLabel m={0} fontWeight="normal" fontSize="md">
            PyTorch index URL
          </FormLabel>
          <Input
            value={customTorchIndexUrl}
            placeholder="https://download.pytorch.org/whl/cu126"
            onChange={onChange}
            variant="outline"
            size="md"
            isInvalid={isInvalid}
          />
        </FormControl>
      </Tooltip>
      {isInvalid && (
        <Text fontSize="md" color="error.300">
          Enter a valid http(s) URL.
        </Text>
      )}
    </Flex>
  );
});
InstallFlowStepConfigureCustomIndexUrl.displayName = 'InstallFlowStepConfigureCustomIndexUrl';
