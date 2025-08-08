import { Box, Divider, Flex, useGlobalModifiersInit } from '@invoke-ai/ui-library';
import { ErrorBoundary } from 'react-error-boundary';

import { ErrorBoundaryFallback } from '@/renderer/app/ErrorBoundaryFallback';
import { MainContent } from '@/renderer/app/MainContent';
import { ThemeProvider } from '@/renderer/app/ThemeProvider';
import { DiscordButton } from '@/renderer/common/DiscordButton';
import { GitHubButton } from '@/renderer/common/GitHubButton';
import { SystemInfoLoadingGate, SystemInfoProvider } from '@/renderer/contexts/SystemInfoContext';
import { Banner } from '@/renderer/features/Banner/Banner';
import { Console } from '@/renderer/features/Console/Console';
import { ConsoleOpenButton } from '@/renderer/features/Console/ConsoleOpenButton';
import { SettingsModal } from '@/renderer/features/SettingsModal/SettingsModal';

import { usePreloadTerminalFont } from './use-preload-terminal-font';

export const App = () => {
  useGlobalModifiersInit();
  usePreloadTerminalFont();

  return (
    <ThemeProvider>
      <SystemInfoProvider>
        <Box w="100dvw" h="100dvh" position="relative" overflow="hidden">
          <ErrorBoundary FallbackComponent={ErrorBoundaryFallback}>
            <SystemInfoLoadingGate>
              <Flex w="full" h="full" flexDir="column" alignItems="center" minH={0}>
                <Banner />
                <Divider />
                <MainContent />
              </Flex>
              <Flex position="absolute" insetBlockEnd={4} insetInlineStart={4}>
                <ConsoleOpenButton />
                <DiscordButton />
                <GitHubButton />
              </Flex>
            </SystemInfoLoadingGate>
            <SettingsModal />
            <Console />
          </ErrorBoundary>
        </Box>
      </SystemInfoProvider>
    </ThemeProvider>
  );
};
