import { IconButton, Menu, MenuButton, MenuItem, MenuList } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo, useCallback } from 'react';
import { PiGlobeHemisphereWestBold } from 'react-icons/pi';

import { LANGUAGES } from '@/renderer/i18n';
import { persistedStoreApi } from '@/renderer/services/store';
import type { LanguageCode } from '@/shared/types';

export const LanguageButton = memo(() => {
  const { language } = useStore(persistedStoreApi.$atom);
  const onChange = useCallback((code: LanguageCode) => {
    void persistedStoreApi.setKey('language', code);
  }, []);

  return (
    <Menu>
      <MenuButton
        as={IconButton}
        variant="link"
        minW={10}
        minH={10}
        colorScheme="base"
        aria-label="Language"
        icon={<PiGlobeHemisphereWestBold />}
      />
      <MenuList maxH="60vh" overflowY="auto">
        {LANGUAGES.map((lang) => (
          <MenuItem
            key={lang.code}
            // eslint-disable-next-line react/jsx-no-bind -- menu item needs per-language callback
            onClick={() => onChange(lang.code as LanguageCode)}
            isDisabled={lang.code === language}
          >
            {lang.native}
          </MenuItem>
        ))}
      </MenuList>
    </Menu>
  );
});
LanguageButton.displayName = 'LanguageButton';
