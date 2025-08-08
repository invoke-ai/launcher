import { useEffect } from 'react';

import { TERMINAL_FONT, TERMINAL_FONT_SIZE } from '@/renderer/constants';

export const usePreloadTerminalFont = () => {
  useEffect(() => {
    document.fonts.load(`${TERMINAL_FONT_SIZE}px ${TERMINAL_FONT}`);
  });
};
