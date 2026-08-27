import { keyframes } from '@emotion/react';
import type { IconButtonProps, SystemStyleObject } from '@invoke-ai/ui-library';
import { IconButton } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo, useCallback } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useTranslation } from 'react-i18next';
import { PiTerminalBold } from 'react-icons/pi';

import { $isConsoleOpen, $terminalHasNewOutput } from '@/renderer/features/Console/state';

const JUMP_HEIGHT = 3;
const jumpAndShake = keyframes`
  0% { transform: translateX(0) }
  25% { transform: translateY(-${JUMP_HEIGHT}px) }
  35% { transform: translateY(-${JUMP_HEIGHT}px) rotate(17deg) }
  55% { transform: translateY(-${JUMP_HEIGHT}px) rotate(-17deg) }
  65% { transform: translateY(-${JUMP_HEIGHT}px) rotate(17deg) }
  75% { transform: translateY(-${JUMP_HEIGHT}px) rotate(-17deg) }
  100% { transform: translateY(0) rotate(0) }
`;

const sx: SystemStyleObject = {
  '&[data-alert="true"] svg': {
    animation: `${jumpAndShake} 0.82s cubic-bezier(.36,.07,.19,.97) both`,
  },
};

type Props = Omit<IconButtonProps, 'aria-label'>;

const hotkeyOptions = {
  enableOnFormTags: true,
};

export const ConsoleOpenButton = memo((props: Props) => {
  const { t } = useTranslation();
  const isOpen = useStore($isConsoleOpen);
  const consolHasNewOutput = useStore($terminalHasNewOutput);
  const openConsole = useCallback(() => {
    $isConsoleOpen.set(true);
  }, []);
  const toggleConsole = useCallback(() => {
    $isConsoleOpen.set(!$isConsoleOpen.get());
  }, []);

  useHotkeys('ctrl+`', toggleConsole, hotkeyOptions);

  return (
    <IconButton
      variant="link"
      minW={10}
      minH={10}
      colorScheme={consolHasNewOutput ? 'invokeYellow' : 'base'}
      aria-label={t('console.open')}
      onClick={openConsole}
      icon={<PiTerminalBold />}
      data-alert={consolHasNewOutput}
      sx={sx}
      pointerEvents={isOpen ? 'none' : 'auto'}
      {...props}
    />
  );
});
ConsoleOpenButton.displayName = 'ConsoleOpenButton';
