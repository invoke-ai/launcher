import type { IconButtonProps } from '@invoke-ai/ui-library';
import { IconButton } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { PiGearFill } from 'react-icons/pi';

import { $isSettingsOpen } from '@/renderer/features/SettingsModal/state';

export const SettingsModalOpenButton = memo((props: Omit<IconButtonProps, 'aria-label'>) => {
  const { t } = useTranslation();
  const isOpen = useStore($isSettingsOpen);
  const onClick = useCallback(() => {
    $isSettingsOpen.set(true);
  }, []);
  return (
    <IconButton
      aria-label={t('settings.title')}
      variant="link"
      minW={10}
      minH={10}
      onClick={onClick}
      icon={<PiGearFill />}
      isDisabled={isOpen}
      {...props}
    />
  );
});
SettingsModalOpenButton.displayName = 'SettingsModalOpenButton';
