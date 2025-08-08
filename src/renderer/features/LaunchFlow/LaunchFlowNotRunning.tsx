import { Button, Divider, Heading, Link, Text } from '@invoke-ai/ui-library';
import { memo, useCallback } from 'react';

import { BodyContainer, BodyContent, BodyFooter, BodyHeader } from '@/renderer/common/layout';
import { Strong } from '@/renderer/common/Strong';
import { installFlowApi } from '@/renderer/features/InstallFlow/state';
import { LaunchFlowUpdateCheckerNotification } from '@/renderer/features/LaunchFlow/LaunchFlowUpdateCheckerNotification';
import { startInvoke } from '@/renderer/features/LaunchFlow/state';
import { emitter } from '@/renderer/services/ipc';
import { selectInstallDir } from '@/renderer/services/store';
import type { DirDetails } from '@/shared/types';

type Props = {
  installDirDetails: Extract<DirDetails, { isInstalled: true }>;
};

export const LaunchFlowNotRunning = memo(({ installDirDetails }: Props) => {
  const launch = useCallback(() => {
    if (!installDirDetails || !installDirDetails.isInstalled) {
      return;
    }
    startInvoke(installDirDetails.path);
  }, [installDirDetails]);

  const install = useCallback(() => {
    installFlowApi.beginFlow(installDirDetails);
  }, [installDirDetails]);

  const openDir = useCallback(() => {
    emitter.invoke('util:open-directory', installDirDetails.path);
  }, [installDirDetails.path]);

  return (
    <BodyContainer>
      <BodyHeader alignItems="flex-end">
        <LaunchFlowUpdateCheckerNotification installDirDetails={installDirDetails} />
      </BodyHeader>
      <BodyContent>
        <Heading>Welcome back.</Heading>
        <Text fontSize="md">
          Using <Strong>Invoke {installDirDetails.version}</Strong> installation at{' '}
          <Strong as={Link} onClick={openDir}>
            {installDirDetails.path}
          </Strong>
          .
        </Text>
      </BodyContent>
      <BodyFooter>
        <Button onClick={selectInstallDir} variant="link">
          Switch installation
        </Button>
        <Divider orientation="vertical" />
        <Button onClick={install} variant="link">
          Manage
        </Button>
        <Divider orientation="vertical" />
        <Button onClick={launch} colorScheme="invokeYellow">
          Launch
        </Button>
      </BodyFooter>
    </BodyContainer>
  );
});
LaunchFlowNotRunning.displayName = 'LaunchFlowNotRunning';
