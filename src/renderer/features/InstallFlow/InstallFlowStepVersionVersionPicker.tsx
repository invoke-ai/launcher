import { Button, ButtonGroup, Flex, Heading, Input, Text } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { valid } from '@renovatebot/pep440';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { EllipsisLoadingText } from '@/renderer/common/EllipsisLoadingText';
import {
  InstallFlowInstallTypeDescription,
  ManualVersionWarning,
} from '@/renderer/features/InstallFlow/InstallFlowInstallTypeDescription';
import { installFlowApi } from '@/renderer/features/InstallFlow/state';
import { $latestGHReleases, syncGHReleases } from '@/renderer/services/gh';

export const InstallFlowStepVersionVersionPicker = memo(() => {
  return (
    <>
      <Heading>Which version should we install?</Heading>
      <VersionPicker />
    </>
  );
});
InstallFlowStepVersionVersionPicker.displayName = 'InstallFlowStepVersionVersionPicker';

const VersionPicker = memo(() => {
  const latestGHReleases = useStore($latestGHReleases);
  const { release } = useStore(installFlowApi.$choices);
  const installType = useStore(installFlowApi.$installType);

  if (latestGHReleases.isError) {
    return (
      <Text role="button" onClick={syncGHReleases} fontSize="md" color="error.300" fontWeight="semibold">
        Unable to get available releases from GitHub. Click here to retry.
      </Text>
    );
  }

  if (latestGHReleases.isLoading || latestGHReleases.isUninitialized) {
    return (
      <EllipsisLoadingText fontSize="md" color="base.300" fontWeight="semibold">
        Loading releases
      </EllipsisLoadingText>
    );
  }

  return (
    <>
      <ButtonGroup variant="outline">
        <StableVersionButton version={latestGHReleases.data.stable} />
        {latestGHReleases.data.pre && <PrereleaseVersionButton version={latestGHReleases.data.pre} />}
        <ManualVersionButton />
      </ButtonGroup>
      {release?.type === 'manual' && <ManualVersionEntry version={release.version} />}
      {installType && <InstallFlowInstallTypeDescription installType={installType} />}
    </>
  );
});
VersionPicker.displayName = 'VersionPicker';

const StableVersionButton = memo(({ version }: { version: string }) => {
  const selectedRelease = useStore(installFlowApi.$choices).release;
  const onClick = useCallback(() => {
    installFlowApi.$choices.setKey('release', { type: 'gh', version, isPrerelease: false });
  }, [version]);

  return (
    <Button
      onClick={onClick}
      colorScheme={selectedRelease?.type === 'gh' && selectedRelease?.version === version ? 'invokeBlue' : 'base'}
    >
      Stable ({version})
    </Button>
  );
});
StableVersionButton.displayName = 'StableVersionButton';

const PrereleaseVersionButton = memo(({ version }: { version: string }) => {
  const selectedRelease = useStore(installFlowApi.$choices).release;
  const onClick = useCallback(() => {
    installFlowApi.$choices.setKey('release', { type: 'gh', version, isPrerelease: true });
  }, [version]);

  return (
    <Button
      onClick={onClick}
      colorScheme={selectedRelease?.type === 'gh' && selectedRelease?.version === version ? 'invokeBlue' : 'base'}
    >
      Prerelease ({version})
    </Button>
  );
});
PrereleaseVersionButton.displayName = 'PrereleaseVersionButton';

const ManualVersionButton = memo(() => {
  const selectedRelease = useStore(installFlowApi.$choices).release;
  const onClick = useCallback(() => {
    installFlowApi.$choices.setKey('release', { type: 'manual', version: '' });
  }, []);

  return (
    <Button onClick={onClick} colorScheme={selectedRelease?.type === 'manual' ? 'invokeBlue' : 'base'}>
      Manual
    </Button>
  );
});
ManualVersionButton.displayName = 'ManualVersionButton';

const ManualVersionEntry = memo(({ version }: { version: string }) => {
  const ref = useRef<HTMLInputElement>(null);
  const [localVersion, setLocalVersion] = useState(version);

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalVersion(e.target.value);
  }, []);

  const onBlur = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalVersion(e.target.value);
    installFlowApi.$choices.setKey('release', { type: 'manual', version: e.target.value });
  }, []);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const isValid = valid(version) !== null;

  return (
    <Flex gap={2} alignItems="center" flexDir="column">
      <Input
        ref={ref}
        value={localVersion}
        placeholder="Enter version"
        onBlur={onBlur}
        onChange={onChange}
        variant="outline"
        maxW={64}
        size="md"
        isInvalid={!!version && !isValid}
      />
      <ManualVersionWarning />
      {!!version && !isValid && (
        <Text fontSize="md" color="error.300">
          Invalid version specifier.
        </Text>
      )}
    </Flex>
  );
});
ManualVersionEntry.displayName = 'ManualVersionEntry';
