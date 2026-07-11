import { Button, ButtonGroup, Flex, Heading, Spinner, Text } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo, useCallback, useEffect } from 'react';

import { InstallFlowStepConfigureGpuPicker } from '@/renderer/features/InstallFlow/InstallFlowStepConfigureGpuPicker';
import { installFlowApi } from '@/renderer/features/InstallFlow/state';
import type { GpuBackend, GpuType } from '@/shared/types';
import { GPU_TYPE_MAP } from '@/shared/types';

/** Human-readable description of a detected backend, for the confirmation prompt. */
const BACKEND_LABEL: Record<GpuBackend, string> = {
  cuda: 'an NVIDIA GPU (CUDA)',
  rocm: 'an AMD GPU (ROCm)',
  metal: 'a Mac GPU (Metal / MPS)',
  cpu: 'no dedicated GPU (CPU only)',
};

/** Non-CUDA backends map straight to a GPU type. CUDA is handled separately because the generation is ambiguous. */
const BACKEND_TO_GPU_TYPE: Record<Exclude<GpuBackend, 'cuda'>, GpuType> = {
  rocm: 'amd',
  metal: 'nogpu',
  cpu: 'nogpu',
};

export const InstallFlowStepConfigureGpuConfirm = memo(() => {
  const detection = useStore(installFlowApi.$gpuDetection);
  const status = useStore(installFlowApi.$gpuDetectionStatus);
  const phase = useStore(installFlowApi.$gpuConfirmPhase);

  // Kick off detection once when this step first mounts (idempotent - the action guards against concurrent runs).
  useEffect(() => {
    if (installFlowApi.$gpuDetectionStatus.get() === 'idle') {
      void installFlowApi.detectGpu();
    }
  }, []);

  // On macOS the only sane answer to "we detected a Mac GPU (Metal / MPS)" is yes, so skip the confirmation prompt and
  // go straight to the summary. The user can still change it from there.
  useEffect(() => {
    if (status === 'done' && detection?.backend === 'metal' && phase === 'confirm') {
      installFlowApi.$choices.setKey('gpuType', BACKEND_TO_GPU_TYPE.metal);
      installFlowApi.$gpuConfirmPhase.set('done');
    }
  }, [status, detection, phase]);

  const onConfirmYes = useCallback(() => {
    const result = installFlowApi.$gpuDetection.get();
    if (!result) {
      return;
    }
    if (result.backend === 'cuda') {
      // We can't auto-detect the Nvidia generation, so force a tier choice before continuing.
      installFlowApi.$choices.setKey('gpuType', null);
      installFlowApi.$gpuConfirmPhase.set('nvidia-tier');
    } else {
      installFlowApi.$choices.setKey('gpuType', BACKEND_TO_GPU_TYPE[result.backend]);
      installFlowApi.$gpuConfirmPhase.set('done');
    }
  }, []);

  const onConfirmNo = useCallback(() => {
    installFlowApi.$choices.setKey('gpuType', null);
    installFlowApi.$gpuConfirmPhase.set('manual');
  }, []);

  // Return from the manual picker to the auto-detected result, so auto-detect is never a dead end.
  const onBackToAutodetect = useCallback(() => {
    installFlowApi.$choices.setKey('gpuType', null);
    installFlowApi.$gpuConfirmPhase.set('confirm');
  }, []);

  const onRetryDetect = useCallback(() => {
    installFlowApi.$choices.setKey('gpuType', null);
    installFlowApi.$gpuConfirmPhase.set('confirm');
    void installFlowApi.detectGpu();
  }, []);

  if (status === 'idle' || status === 'detecting') {
    return (
      <Flex flexDir="column" gap={3} alignItems="center">
        <Spinner />
        <Text fontSize="md">Detecting your hardware…</Text>
      </Flex>
    );
  }

  // Detection failed - fall back to the manual picker, but keep a way to retry auto-detect.
  if (status === 'error' || !detection) {
    return (
      <Flex flexDir="column" gap={3} alignItems="center" w="full">
        <Text fontSize="md">We couldn&apos;t detect your GPU automatically. Please choose:</Text>
        <InstallFlowStepConfigureGpuPicker />
        <Button variant="link" onClick={onRetryDetect}>
          Try auto-detect again
        </Button>
      </Flex>
    );
  }

  if (phase === 'manual') {
    return (
      <Flex flexDir="column" gap={3} alignItems="center" w="full">
        <InstallFlowStepConfigureGpuPicker />
        <Button variant="link" onClick={onBackToAutodetect}>
          Use the auto-detected result instead
        </Button>
      </Flex>
    );
  }

  if (phase === 'nvidia-tier') {
    return <NvidiaTierPicker onBack={onConfirmNo} />;
  }

  if (phase === 'done') {
    return <DetectedSummary onChange={onConfirmNo} />;
  }

  // A discrete AMD GPU on Windows is reported as the CPU backend (no ROCm on Windows), so give it an honest message
  // rather than the misleading "no dedicated GPU".
  const isWindowsAmd = detection.backend === 'cpu' && detection.vendor === 'amd';
  const detectionHeading = isWindowsAmd
    ? 'We detected an AMD GPU, but ROCm is not supported on Windows, so Invoke will use your CPU.'
    : `We detected ${BACKEND_LABEL[detection.backend]}.`;

  // phase === 'confirm'
  return (
    <Flex flexDir="column" gap={4} alignItems="center" maxW={112}>
      <Heading size="sm" textAlign="center">
        {detectionHeading}
      </Heading>
      <Text fontSize="md" textAlign="center">
        Is this correct?
      </Text>
      <ButtonGroup variant="outline">
        <Button colorScheme="invokeYellow" onClick={onConfirmYes}>
          Yes, that&apos;s right
        </Button>
        <Button onClick={onConfirmNo}>No, let me choose</Button>
      </ButtonGroup>
    </Flex>
  );
});
InstallFlowStepConfigureGpuConfirm.displayName = 'InstallFlowStepConfigureGpuConfirm';

const NvidiaTierPicker = memo(({ onBack }: { onBack: () => void }) => {
  const { gpuType } = useStore(installFlowApi.$choices);
  const onClickOld = useCallback(() => installFlowApi.$choices.setKey('gpuType', 'nvidia<30xx'), []);
  const onClickNew = useCallback(() => installFlowApi.$choices.setKey('gpuType', 'nvidia>=30xx'), []);
  return (
    <Flex flexDir="column" gap={3} alignItems="center">
      <Heading size="sm">Which NVIDIA generation do you have?</Heading>
      <ButtonGroup variant="outline">
        <Button colorScheme={gpuType === 'nvidia<30xx' ? 'invokeBlue' : 'base'} onClick={onClickOld}>
          {GPU_TYPE_MAP['nvidia<30xx']}
        </Button>
        <Button colorScheme={gpuType === 'nvidia>=30xx' ? 'invokeBlue' : 'base'} onClick={onClickNew}>
          {GPU_TYPE_MAP['nvidia>=30xx']}
        </Button>
      </ButtonGroup>
      <Button variant="link" onClick={onBack}>
        Pick a different GPU
      </Button>
    </Flex>
  );
});
NvidiaTierPicker.displayName = 'NvidiaTierPicker';

const DetectedSummary = memo(({ onChange }: { onChange: () => void }) => {
  const { gpuType } = useStore(installFlowApi.$choices);
  return (
    <Flex flexDir="column" gap={3} alignItems="center">
      <Text fontSize="md">
        Using <strong>{gpuType ? GPU_TYPE_MAP[gpuType] : ''}</strong>.
      </Text>
      <Button variant="link" onClick={onChange}>
        Change
      </Button>
    </Flex>
  );
});
DetectedSummary.displayName = 'DetectedSummary';
