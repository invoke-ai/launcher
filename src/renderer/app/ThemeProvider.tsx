import '@/renderer/styles/global.css';
import '@fontsource-variable/inter';
import '@xterm/xterm/css/xterm.css';

import { ChakraProvider, DarkMode, extendTheme, theme as invokeTheme, TOAST_OPTIONS } from '@invoke-ai/ui-library';
import { cloneDeep, unset } from 'es-toolkit/compat';
import type { PropsWithChildren } from 'react';
import { memo } from 'react';

const themeClone = cloneDeep(invokeTheme);
unset(themeClone, 'styles.global.*.::-webkit-scrollbar');
unset(themeClone, 'styles.global.*.scrollbarWidth');

const theme = extendTheme(themeClone);

export const ThemeProvider = memo(({ children }: PropsWithChildren) => {
  return (
    <ChakraProvider theme={theme} toastOptions={TOAST_OPTIONS}>
      <DarkMode>{children}</DarkMode>
    </ChakraProvider>
  );
});

ThemeProvider.displayName = 'ThemeProvider';
