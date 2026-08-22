import { Button, ButtonGroup, ExternalLink, Flex, Heading, Input, Text } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { valid } from '@renovatebot/pep440';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EllipsisLoadingText } from '@/renderer/common/EllipsisLoadingText';
import {
  InstallFlowInstallTypeDescription,
  ManualVersionWarning,
} from '@/renderer/features/InstallFlow/InstallFlowInstallTypeDescription';
import { installFlowApi } from '@/renderer/features/InstallFlow/state';
import type { GHReleaseData } from '@/renderer/services/gh';
import { $latestGHReleases, syncGHReleases } from '@/renderer/services/gh';

export const InstallFlowStepVersionVersionPicker = memo(() => {
  const { t } = useTranslation();
  return (
    <>
      <Heading>{t('installFlow.version.title')}</Heading>
      <VersionPicker />
    </>
  );
});
InstallFlowStepVersionVersionPicker.displayName = 'InstallFlowStepVersionVersionPicker';

const VersionPicker = memo(() => {
  const { t } = useTranslation();
  const latestGHReleases = useStore($latestGHReleases);
  const { release } = useStore(installFlowApi.$choices);
  const installType = useStore(installFlowApi.$installType);

  if (latestGHReleases.isError) {
    return (
      <Text role="button" onClick={syncGHReleases} fontSize="md" color="error.300" fontWeight="semibold">
        {t('installFlow.version.releasesError')}
      </Text>
    );
  }

  if (latestGHReleases.isLoading || latestGHReleases.isUninitialized) {
    return (
      <EllipsisLoadingText fontSize="md" color="base.300" fontWeight="semibold">
        {t('installFlow.version.loading')}
      </EllipsisLoadingText>
    );
  }

  return (
    <>
      <ButtonGroup variant="outline">
        <StableVersionButton release={latestGHReleases.data.stable} />
        {latestGHReleases.data.pre && <PrereleaseVersionButton release={latestGHReleases.data.pre} />}
        <ManualVersionButton />
      </ButtonGroup>
      {release?.type === 'manual' && <ManualVersionEntry version={release.version} />}
      {installType && <InstallFlowInstallTypeDescription installType={installType} />}
      {release?.type === 'gh' && <GHVersionLink release={release} />}
    </>
  );
});
VersionPicker.displayName = 'VersionPicker';

const GHVersionLink = memo(({ release }: { release: GHReleaseData }) => {
  const { t } = useTranslation();
  return <ExternalLink fontSize="md" color="base.300" href={release.url} label={t('installFlow.version.releaseNotes')} />;
});
GHVersionLink.displayName = 'GHVersionLink';

const StableVersionButton = memo(({ release }: { release: GHReleaseData }) => {
  const { t } = useTranslation();
  const selectedRelease = useStore(installFlowApi.$choices).release;
  const onClick = useCallback(() => {
    installFlowApi.$choices.setKey('release', { type: 'gh', ...release, isPrerelease: false });
  }, [release]);

  return (
    <Button
      onClick={onClick}
      colorScheme={
        selectedRelease?.type === 'gh' && selectedRelease?.version === release.version ? 'invokeBlue' : 'base'
      }
    >
      {t('installFlow.version.stable', { version: release.version })}
    </Button>
  );
});
StableVersionButton.displayName = 'StableVersionButton';

const PrereleaseVersionButton = memo(({ release }: { release: GHReleaseData }) => {
  const { t } = useTranslation();
  const selectedRelease = useStore(installFlowApi.$choices).release;
  const onClick = useCallback(() => {
    installFlowApi.$choices.setKey('release', { type: 'gh', ...release, isPrerelease: true });
  }, [release]);

  return (
    <Button
      onClick={onClick}
      colorScheme={
        selectedRelease?.type === 'gh' && selectedRelease?.version === release.version ? 'invokeBlue' : 'base'
      }
    >
      {t('installFlow.version.prerelease', { version: release.version })}
    </Button>
  );
});
PrereleaseVersionButton.displayName = 'PrereleaseVersionButton';

const ManualVersionButton = memo(() => {
  const { t } = useTranslation();
  const selectedRelease = useStore(installFlowApi.$choices).release;
  const onClick = useCallback(() => {
    installFlowApi.$choices.setKey('release', { type: 'manual', version: '' });
  }, []);

  return (
    <Button
      variant="outline"
      onClick={onClick}
      colorScheme={selectedRelease?.type === 'manual' ? 'invokeBlue' : 'base'}
    >
      {t('installFlow.version.manual')}
    </Button>
  );
});
ManualVersionButton.displayName = 'ManualVersionButton';

const ManualVersionEntry = memo(({ version }: { version: string }) => {
  const { t } = useTranslation();
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
        placeholder={t('installFlow.version.enterVersion')}
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
          {t('installFlow.version.invalidSpecifier')}
        </Text>
      )}
    </Flex>
  );
});
ManualVersionEntry.displayName = 'ManualVersionEntry';
