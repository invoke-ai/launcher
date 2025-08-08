import { objectEquals } from '@observ33r/object-equals';
import { compare } from '@renovatebot/pep440';
import { Terminal } from '@xterm/xterm';
import { clamp } from 'es-toolkit/compat';
import type { ReadableAtom } from 'nanostores';
import { atom, computed, map } from 'nanostores';
import { assert } from 'tsafe';

import { withResultAsync } from '@/lib/result';
import { DEFAULT_XTERM_OPTIONS, STATUS_POLL_INTERVAL_MS } from '@/renderer/constants';
import { $latestGHReleases } from '@/renderer/services/gh';
import { emitter, ipc } from '@/renderer/services/ipc';
import {
  $installDirDetails,
  $operatingSystem,
  persistedStoreApi,
  syncInstallDirDetails,
} from '@/renderer/services/store';
import type { DirDetails, GpuType, InstallProcessStatus, InstallType, WithTimestamp } from '@/shared/types';

const steps = ['Location', 'Version', 'Configure', 'Review', 'Install'] as const;

const $choices = map<{
  dirDetails: DirDetails | null;
  gpuType: GpuType | null;
  release:
    | {
        type: 'gh';
        version: string;
        isPrerelease?: boolean;
      }
    | { type: 'manual'; version: string }
    | null;
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

  if (release.type === 'manual') {
    return { type: 'manual', newVersion, installedVersion };
  }

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
    $choices.set({
      dirDetails: dirDetails ?? null,
      gpuType: null,
      release: null,
      repairMode: false,
    });
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
    initializeTerminal();
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
    teardownTerminal();
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

  $choices.setKey('release', { type: 'gh', version: latestGHReleases.data.stable, isPrerelease: false });
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

export const $installProcessXTerm = atom<Terminal | null>(null);
const terminalSubscriptions = new Set<() => void>();

const initializeTerminal = (): Terminal => {
  let xterm = $installProcessXTerm.get();

  if (xterm) {
    return xterm;
  }

  xterm = new Terminal({ ...DEFAULT_XTERM_OPTIONS, disableStdin: true });

  terminalSubscriptions.add(
    ipc.on('install-process:log', (_, data) => {
      // Only handle structured logs that aren't from PTY
      // PTY output comes through the raw-output channel
      xterm.write(data.message);
    })
  );

  terminalSubscriptions.add(
    ipc.on('install-process:raw-output', (_, data) => {
      // Write raw PTY output directly to xterm terminal
      xterm.write(data);
    })
  );

  terminalSubscriptions.add(
    xterm.onResize(({ cols, rows }) => {
      emitter.invoke('install-process:resize', cols, rows);
    }).dispose
  );

  $installProcessXTerm.set(xterm);
  return xterm;
};

const teardownTerminal = () => {
  for (const unsubscribe of terminalSubscriptions) {
    unsubscribe();
  }
  terminalSubscriptions.clear();
  const xterm = $installProcessXTerm.get();
  if (!xterm) {
    return;
  }
  xterm.dispose();
  $installProcessXTerm.set(null);
};

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
  ipc.on('install-process:status', (_, status) => {
    $installProcessStatus.set(status);
    if (status.type === 'canceled' || status.type === 'completed' || status.type === 'error') {
      // If the install was canceled or errored, we need to force a sync of the install dir details in case something
      // broke
      syncInstallDirDetails();
    }
  });

  const poll = async () => {
    const oldStatus = $installProcessStatus.get();
    const newStatus = await emitter.invoke('install-process:get-status');
    if (objectEquals(oldStatus, newStatus)) {
      return;
    }
    $installProcessStatus.set(newStatus);
  };

  setInterval(poll, STATUS_POLL_INTERVAL_MS);
};

listen();
