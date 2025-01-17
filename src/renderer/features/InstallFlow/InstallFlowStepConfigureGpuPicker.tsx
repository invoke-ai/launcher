import { Button, ButtonGroup, Heading, Text } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo, useCallback } from 'react';

import { useSystemInfo } from '@/renderer/contexts/SystemInfoContext';
import { installFlowApi } from '@/renderer/features/InstallFlow/state';
import type { GpuType } from '@/shared/types';
import { GPU_TYPE_MAP } from '@/shared/types';

export const InstallFlowStepConfigureGpuPicker = memo(() => {
  const { operatingSystem } = useSystemInfo();

  return (
    <>
      <Heading>What GPU do you have?</Heading>
      <ButtonGroup variant="outline">
        <GpuButton type="nvidia<30xx" />
        <GpuButton type="nvidia>=30xx" />
        <GpuButton type="amd" />
        <GpuButton type="nogpu" />
      </ButtonGroup>
      {operatingSystem === 'macOS' && <Text fontSize="md">Tip: Macs usually have no dedicated GPU.</Text>}
    </>
  );
});
InstallFlowStepConfigureGpuPicker.displayName = 'InstallFlowStepConfigureGpuPicker';

const GpuButton = memo(({ type }: { type: GpuType }) => {
  const { gpuType } = useStore(installFlowApi.$choices);
  const onClick = useCallback(() => {
    installFlowApi.$choices.setKey('gpuType', type);
  }, [type]);

  return (
    <Button onClick={onClick} colorScheme={gpuType === type ? 'invokeBlue' : 'base'}>
      {GPU_TYPE_MAP[type]}
    </Button>
  );
});
GpuButton.displayName = 'GpuButton';
