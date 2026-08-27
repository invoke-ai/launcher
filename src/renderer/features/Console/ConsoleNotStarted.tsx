import { Button, Flex, Text } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { Strong } from '@/renderer/common/Strong';
import { useNewTerminal } from '@/renderer/features/Console/use-new-terminal';
import { $installDirDetails } from '@/renderer/services/store';

export const ConsoleNotRunning = memo(() => {
  const { t } = useTranslation();
  const installDir = useStore($installDirDetails);
  const newTerminal = useNewTerminal();
  return (
    <Flex position="relative" flexDir="column" w="full" h="full" alignItems="center" justifyContent="center" gap={4}>
      <Button variant="link" onClick={newTerminal}>
        {t('console.notStarted.start')}
      </Button>
      {installDir?.isInstalled && (
        <Text fontSize="md">
          {t('console.notStarted.activatePrefix')} <Strong>{installDir.path}</Strong>
          {t('console.notStarted.activateSuffix')}
        </Text>
      )}
    </Flex>
  );
});
ConsoleNotRunning.displayName = 'ConsoleNotRunning';
