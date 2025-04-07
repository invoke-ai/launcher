import { Flex, Icon, Link, Text } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo, useCallback } from 'react';
import { PiArrowsCounterClockwise } from 'react-icons/pi';

import { EllipsisLoadingText } from '@/renderer/common/EllipsisLoadingText';
import { Strong } from '@/renderer/common/Strong';
import { installFlowApi } from '@/renderer/features/InstallFlow/state';
import { $latestInvokeReleases, syncInvokeReleases, useInvokeAvailableUpdates } from '@/renderer/services/gh';
import { persistedStoreApi } from '@/renderer/services/store';
import type { DirDetails } from '@/shared/types';

type Props = {
  installDirDetails: Extract<DirDetails, { isInstalled: true }>;
};

export const LaunchFlowUpdateCheckerNotification = memo(({ installDirDetails }: Props) => {
  const latestGHReleases = useStore($latestInvokeReleases);
  const availableUpdates = useInvokeAvailableUpdates(installDirDetails.version);
  const { notifyForPrereleaseUpdates } = useStore(persistedStoreApi.$atom);

  const beginInstallFlow = useCallback(() => {
    installFlowApi.beginFlow(installDirDetails);
  }, [installDirDetails]);

  if (latestGHReleases.isError) {
    return (
      <Flex as={Link} onClick={syncInvokeReleases} alignItems="center" gap={2} userSelect="none">
        <Text color="error.300">Unable to check for updates.</Text>
        <Icon as={PiArrowsCounterClockwise} boxSize={4} />
      </Flex>
    );
  }

  if (latestGHReleases.isLoading || latestGHReleases.isUninitialized) {
    return (
      <EllipsisLoadingText fontSize="sm" userSelect="none" color="base.300">
        Checking for updates
      </EllipsisLoadingText>
    );
  }

  if (availableUpdates.stable !== null) {
    return (
      <Text as={Link} onClick={beginInstallFlow} color="invokeGreen.300" userSelect="none">
        Invoke <Strong fontSize="sm">{availableUpdates.stable}</Strong> is available! Click here to update.
      </Text>
    );
  }

  if (availableUpdates.pre !== null && notifyForPrereleaseUpdates) {
    return (
      <Text as={Link} onClick={beginInstallFlow} color="invokeGreen.300" userSelect="none">
        Invoke <Strong fontSize="sm">{availableUpdates.pre}</Strong> is available! Click here to update.
      </Text>
    );
  }

  return (
    <Flex as={Link} onClick={syncInvokeReleases} alignItems="center" gap={2} userSelect="none" color="base.300">
      <Text>Up to date.</Text>
      <Icon as={PiArrowsCounterClockwise} boxSize={4} />
    </Flex>
  );
});
LaunchFlowUpdateCheckerNotification.displayName = 'LaunchFlowUpdateCheckerNotification';
