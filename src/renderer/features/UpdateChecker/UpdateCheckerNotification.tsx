import { Flex, Icon, Link, Text } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo, useCallback } from 'react';
import { PiArrowsCounterClockwise } from 'react-icons/pi';

import { EllipsisLoadingText } from '@/renderer/common/EllipsisLoadingText';
import { Strong } from '@/renderer/common/Strong';
import { $launcherVersion } from '@/renderer/features/Banner/state';
import { installFlowApi } from '@/renderer/features/InstallFlow/state';
import {
  $latestInvokeReleases,
  $latestLauncherReleases,
  syncAllReleases,
  useInvokeAvailableUpdates,
  useLauncherAvailableUpdates,
} from '@/renderer/services/gh';
import { $installDirDetails, persistedStoreApi } from '@/renderer/services/store';

export const UpdateCheckerNotification = memo(() => {
  const { notifyForPrereleaseUpdates } = useStore(persistedStoreApi.$atom);
  const installDirDetails = useStore($installDirDetails);
  const latestInvokeReleases = useStore($latestInvokeReleases);
  const availableInvokeUpdates = useInvokeAvailableUpdates(
    installDirDetails?.isInstalled ? installDirDetails.version : undefined
  );

  const launcherVersion = useStore($launcherVersion);
  const latestLauncherReleases = useStore($latestLauncherReleases);
  const availableLauncherUpdates = useLauncherAvailableUpdates(launcherVersion);

  const beginInstallFlow = useCallback(() => {
    installFlowApi.beginFlow(installDirDetails);
  }, [installDirDetails]);

  if (latestInvokeReleases.isError || latestLauncherReleases.isError) {
    return (
      <Flex as={Link} onClick={syncAllReleases} alignItems="center" gap={2} userSelect="none">
        <Text color="error.300">Unable to check for updates.</Text>
        <Icon as={PiArrowsCounterClockwise} boxSize={4} />
      </Flex>
    );
  }

  if (
    latestInvokeReleases.isLoading ||
    latestInvokeReleases.isUninitialized ||
    latestLauncherReleases.isLoading ||
    latestLauncherReleases.isUninitialized
  ) {
    return (
      <EllipsisLoadingText fontSize="sm" userSelect="none" color="base.300">
        Checking for updates
      </EllipsisLoadingText>
    );
  }

  if (availableInvokeUpdates.stable !== null) {
    return (
      <Text as={Link} onClick={beginInstallFlow} color="invokeGreen.300" userSelect="none">
        Invoke <Strong fontSize="sm">{availableInvokeUpdates.stable}</Strong> is available! Click here to update.
      </Text>
    );
  }

  if (availableInvokeUpdates.pre !== null && notifyForPrereleaseUpdates) {
    return (
      <Text as={Link} onClick={beginInstallFlow} color="invokeGreen.300" userSelect="none">
        Invoke <Strong fontSize="sm">{availableInvokeUpdates.pre}</Strong> is available! Click here to update.
      </Text>
    );
  }

  return (
    <Flex as={Link} onClick={syncAllReleases} alignItems="center" gap={2} userSelect="none" color="base.300">
      <Text>Up to date.</Text>
      <Icon as={PiArrowsCounterClockwise} boxSize={4} />
    </Flex>
  );
});
UpdateCheckerNotification.displayName = 'UpdateCheckerNotification';
