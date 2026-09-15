import { Button, ButtonGroup, Heading, Text } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo, useCallback } from 'react';

import { useSystemInfo } from '@/renderer/contexts/SystemInfoContext';
import { installFlowApi } from '@/renderer/features/InstallFlow/state';
import type { GpuType } from '@/shared/types';
import { GPU_TYPE_MAP } from '@/shared/types';

export const InstallFlowStepConfigureGpuPicker = memo(() => {
  const { operatingSystem, systemArch } = useSystemInfo();
  // Windows on ARM64 (NVIDIA RTX Spark): the only torch build is NVIDIA's; AMD and Intel accelerators have none.
  const isWindowsArm64 = operatingSystem === 'Windows' && systemArch === 'arm64';

  return (
    <>
      <Heading>What GPU do you have?</Heading>
      <ButtonGroup variant="outline" flexWrap="wrap" justifyContent="center" rowGap={2}>
        <GpuButton type="nvidia<30xx" />
        <GpuButton type="nvidia>=30xx" />
        {!isWindowsArm64 && <GpuButton type="amd" />}
        {/* PyTorch publishes +xpu wheels for linux-x86_64 and windows-amd64 only - on a Mac, Intel means Metal or CPU. */}
        {operatingSystem !== 'macOS' && !isWindowsArm64 && <GpuButton type="intel" />}
        <GpuButton type="nogpu" />
      </ButtonGroup>
      {operatingSystem === 'macOS' && <Text fontSize="md">Tip: Macs usually have no dedicated GPU.</Text>}
      {isWindowsArm64 && (
        <Text fontSize="md">
          Windows on ARM64: torch is installed from NVIDIA&apos;s RTX Spark index for every choice.
        </Text>
      )}
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
