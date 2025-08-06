import type { BoxProps } from '@invoke-ai/ui-library';
import { Flex, Text } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { filesize } from 'filesize';
import { useEffect, useState } from 'react';

import { ipc } from '@/renderer/services/ipc';
import { persistedStoreApi } from '@/renderer/services/store';

const FOUR_GB_IN_BYTES = 4 * 1024 * 1024 * 1024;
const THRESHOLD = FOUR_GB_IN_BYTES * 0.9;

export const UIMemoryMonitor = (props: BoxProps) => {
  const [metrics, setMetrics] = useState<{ memoryBytes: number; cpuPercent: number } | null>(null);
  const { showUIWindowMemoryMonitor } = useStore(persistedStoreApi.$atom);

  useEffect(() => {
    const unsubscribe = ipc.on('invoke-process:metrics', (e, metrics) => {
      setMetrics(metrics);
    });

    return unsubscribe;
  }, []);

  if (!metrics || !showUIWindowMemoryMonitor) {
    return null;
  }

  return (
    <Flex
      gap={2}
      bg="base.900"
      borderRadius="base"
      userSelect="none"
      px={3}
      py={1}
      opacity={0.8}
      borderWidth={1}
      shadow="dark-lg"
      {...props}
    >
      <Text color={metrics.memoryBytes > THRESHOLD ? 'error.300' : undefined}>
        UI Memory: {filesize(metrics.memoryBytes)}
      </Text>
    </Flex>
  );
};
