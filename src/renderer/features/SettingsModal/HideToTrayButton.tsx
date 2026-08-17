import type { IconButtonProps } from '@invoke-ai/ui-library';
import { IconButton } from '@invoke-ai/ui-library';
import { memo, useCallback } from 'react';
import { PiArrowLineDownBold } from 'react-icons/pi';

import { emitter } from '@/renderer/services/ipc';

export const HideToTrayButton = memo((props: Omit<IconButtonProps, 'aria-label'>) => {
  const onClick = useCallback(() => {
    emitter.invoke('main-process:hide-to-tray');
  }, []);
  return (
    <IconButton
      aria-label="Minimize to tray"
      tooltip="Minimize to tray"
      variant="link"
      minW={10}
      minH={10}
      onClick={onClick}
      icon={<PiArrowLineDownBold />}
      {...props}
    />
  );
});
HideToTrayButton.displayName = 'HideToTrayButton';
