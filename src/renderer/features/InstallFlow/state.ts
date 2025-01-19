import { compare } from '@renovatebot/pep440';
import { clamp, isEqual } from 'lodash-es';
import type { ReadableAtom } from 'nanostores';
import { atom, computed, map } from 'nanostores';
import { assert } from 'tsafe';

import { LineBuffer } from '@/lib/line-buffer';
import { withResultAsync } from '@/lib/result';
import { POLL_INTERVAL } from '@/renderer/constants';
import { $latestGHReleases } from '@/renderer/services/gh';
import { emitter, ipc } from '@/renderer/services/ipc';
import {
  $installDirDetails,
  $operatingSystem,
  persistedStoreApi,
  syncInstallDirDetails,
} from '@/renderer/services/store';
import type { DirDetails, GpuType, InstallProcessStatus, InstallType, LogEntry, WithTimestamp } from '@/shared/types';

const steps = ['Location', 'Version', 'Configure', 'Review', 'Install'] as const;

const $choices = map<{
  dirDetails: DirDetails | null;
  gpuType: GpuType | null;
  release: { version: string; isPrerelease: boolean } | null;
  repairMode: boolean;
}>({
  dirDetails: null,
  gpuType: null,
  release: null,
  repairMode: false,
});

const $activeStep = atom(0);
const $isStarted = atom(false);
const $isFinished = atom(false);
const $installType = computed($choices, ({ dirDetails, release }): InstallType | null => {
  if (!release) {
    return null;
  }

  const newVersion = release.version;

  if (!dirDetails || !dirDetails.isInstalled) {
    return { type: 'fresh', newVersion };
  }

  const installedVersion = dirDetails.version;

  const comparison = compare(newVersion, installedVersion);

  if (comparison === 0) {
    return { type: 'reinstall', newVersion, installedVersion };
  }

  if (comparison > 0) {
    return { type: 'upgrade', newVersion, installedVersion };
  }

  return { type: 'downgrade', newVersion, installedVersion };
});

export const installFlowApi = {
  steps,
  // Mutable atoms
  $choices,
  // Computed atoms
  $installType,
  // Type as read-only to prevent accidental modification
  $activeStep: $activeStep as ReadableAtom<number>,
  $isStarted: $isStarted as ReadableAtom<boolean>,
  $isFinished: $isFinished as ReadableAtom<boolean>,
  nextStep: () => {
    const currentStep = $activeStep.get();
    $activeStep.set(clamp(currentStep + 1, 0, installFlowApi.steps.length - 1));
  },
  prevStep: () => {
    const currentStep = $activeStep.get();
    $activeStep.set(clamp(currentStep - 1, 0, installFlowApi.steps.length - 1));
  },
  beginFlow: (dirDetails?: DirDetails) => {
    $choices.set({ dirDetails: dirDetails ?? null, gpuType: null, release: null, repairMode: false });
    $activeStep.set(0);
    $isStarted.set(true);
  },
  cancelFlow: () => {
    $choices.set({
      dirDetails: null,
      gpuType: null,
      release: null,
      repairMode: false,
    });
    $activeStep.set(0);
    $isStarted.set(false);
  },
  startInstall: () => {
    const { dirDetails, gpuType, release, repairMode } = $choices.get();
    if (!dirDetails || !dirDetails.canInstall || !release || !gpuType) {
      return;
    }
    $installProcessLogs.set([]);
    emitter.invoke('install-process:start-install', dirDetails.path, gpuType, release.version, repairMode);
    installFlowApi.nextStep();
  },
  cancelInstall: async () => {
    await emitter.invoke('install-process:cancel-install');
    $isFinished.set(true);
  },
  finalizeInstall: async () => {
    const result = await withResultAsync(async () => {
      const { dirDetails } = installFlowApi.$choices.get();
      assert(dirDetails);
      const newDetails = await emitter.invoke('util:get-dir-details', dirDetails.path);
      assert(newDetails.isInstalled);
      return newDetails;
    });

    if (result.isOk()) {
      persistedStoreApi.setKey('installDir', result.value.path);
      $installDirDetails.set(result.value);
    }

    $isFinished.set(false);
    installFlowApi.cancelFlow();
  },
};

const syncReleaseChoiceWithLatestReleases = () => {
  if ($choices.get().release) {
    return;
  }

  const latestGHReleases = $latestGHReleases.get();

  if (!latestGHReleases.isSuccess) {
    return;
  }

  $choices.setKey('release', { version: latestGHReleases.data.stable, isPrerelease: false });
};

$latestGHReleases.listen(syncReleaseChoiceWithLatestReleases);
$choices.listen(syncReleaseChoiceWithLatestReleases);

const syncGpuTypeWithOperatingSystem = () => {
  if ($choices.get().gpuType) {
    return;
  }

  const operatingSystem = $operatingSystem.get();

  $choices.setKey('gpuType', operatingSystem === 'macOS' ? 'nogpu' : 'nvidia>=30xx');
};

$operatingSystem.listen(syncGpuTypeWithOperatingSystem);
$choices.listen(syncGpuTypeWithOperatingSystem);

export const $installProcessStatus = atom<WithTimestamp<InstallProcessStatus>>({
  type: 'uninitialized',
  timestamp: Date.now(),
});

$installProcessStatus.subscribe((status, oldStatus) => {
  if (oldStatus && getIsActiveInstallProcessStatus(oldStatus) && !getIsActiveInstallProcessStatus(status)) {
    $isFinished.set(true);
    // To get chakra to show a checkmark on the last step, the active step must be the step _after_ the last step
    $activeStep.set(steps.length);
  }
});

export const $installProcessLogs = atom<WithTimestamp<LogEntry>[]>([]);

export const getIsActiveInstallProcessStatus = (status: InstallProcessStatus) => {
  switch (status.type) {
    case 'installing':
    case 'canceling':
    case 'exiting':
    case 'starting':
      return true;
    default:
      return false;
  }
};

const listen = () => {
  const buffer = new LineBuffer({ stripAnsi: true });

  ipc.on('install-process:log', (_, data) => {
    const buffered = buffer.append(data.message);
    for (const message of buffered) {
      $installProcessLogs.set([...$installProcessLogs.get(), { ...data, message }]);
    }
  });

  ipc.on('install-process:status', (_, status) => {
    $installProcessStatus.set(status);
    if (status.type === 'canceled' || status.type === 'completed' || status.type === 'error') {
      // Flush the buffer when the process exits in case there were any remaining logs
      buffer.flush();

      // If the install was canceled or errored, we need to force a sync of the install dir details in case something
      // broke
      syncInstallDirDetails();
    }
  });

  const poll = async () => {
    const oldStatus = $installProcessStatus.get();
    const newStatus = await emitter.invoke('install-process:get-status');
    if (isEqual(oldStatus, newStatus)) {
      return;
    }
    $installProcessStatus.set(newStatus);
  };

  setInterval(poll, POLL_INTERVAL);
};

listen();
