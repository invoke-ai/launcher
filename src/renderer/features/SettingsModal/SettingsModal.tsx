import {
  Box,
  Divider,
  Flex,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Spacer,
} from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo, useCallback } from 'react';

import { SettingsModalInvokeNotifyForPrereleaseUpdates } from '@/renderer/features/SettingsModal/SettingsModalInvokeNotifyForPrereleaseUpdates';
import { SettingsModalInvokeServerMode } from '@/renderer/features/SettingsModal/SettingsModalInvokeServerMode';
import { SettingsModalOptInToLauncherPrereleases } from '@/renderer/features/SettingsModal/SettingsModalOptInToLauncherPrereleases';
import { SettingsModalResetButton } from '@/renderer/features/SettingsModal/SettingsModalResetButton';
import { $isSettingsOpen } from '@/renderer/features/SettingsModal/state';

export const SettingsModal = memo(() => {
  const isOpen = useStore($isSettingsOpen);
  const onClose = useCallback(() => {
    $isSettingsOpen.set(false);
  }, []);
  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered>
      <ModalOverlay bg="transparent" backdropFilter="auto" backdropBlur="32px">
        <Box position="absolute" inset={0} bg="base.900" opacity={0.7} />
      </ModalOverlay>
      <ModalContent>
        <ModalHeader>Settings</ModalHeader>
        <ModalCloseButton />
        <ModalBody as={Flex} flexDir="column" gap={4} w="full" h="full" minH={32}>
          <SettingsModalInvokeServerMode />
          <Divider />
          <SettingsModalInvokeNotifyForPrereleaseUpdates />
          <Divider />
          <SettingsModalOptInToLauncherPrereleases />
        </ModalBody>
        <ModalFooter pt={16}>
          <SettingsModalResetButton />
          <Spacer />
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
});
SettingsModal.displayName = 'SettingsModal';
