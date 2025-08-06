import type { IpcListener } from '@electron-toolkit/typed-ipc/main';
import { ipcMain } from 'electron';

import { PtyManager } from '@/lib/pty';
import { getActivateVenvCommand, getBundledBinPath, getHomeDirectory, getInstallationDetails } from '@/main/util';
import type { IpcEvents, IpcRendererEvents, PtyOptions } from '@/shared/types';

export const createPtyManager = (arg: {
  ipc: IpcListener<IpcEvents>;
  sendToWindow: <T extends keyof IpcRendererEvents>(channel: T, ...args: IpcRendererEvents[T]) => void;
}) => {
  const { ipc, sendToWindow } = arg;
  const options: PtyManager['options'] = {
    maxHistorySize: 2_000,
  };

  const ptyManager = new PtyManager(options);

  const onData = (id: string, data: string) => {
    sendToWindow('terminal:output', id, data);
  };
  const onExit = (id: string, exitCode: number) => {
    sendToWindow('terminal:exited', id, exitCode);
  };

  ipc.handle('terminal:replay', (_, id) => ptyManager.replay(id));
  ipc.handle('terminal:create', async (_, cwd) => {
    const options: PtyOptions = {
      cwd: getHomeDirectory(),
    };
    const entry = ptyManager.create({ onData, onExit, options });

    // Add the bundled bin dir to the PATH env var
    if (process.platform === 'win32') {
      entry.process.write(`$env:Path='${getBundledBinPath()};'+$env:Path\r`);
    } else {
      // macOS, Linux
      entry.process.write(`export PATH="${getBundledBinPath()}:$PATH"\r`);
    }

    if (cwd) {
      const installDetails = await getInstallationDetails(cwd);
      // If the cwd is a valid installation dir, we should activate the venv
      if (installDetails.isInstalled) {
        const activateVenvCmd = getActivateVenvCommand(installDetails.path);
        entry.process.write(`${activateVenvCmd}\r`);
      }
      // If the cwd is a directory, we should cd into it, even if it is not a valid installation dir - the user may
      // want to run commands there to fix something.
      if (installDetails.isDirectory) {
        entry.process.write(`cd ${cwd}\r`);
      }
    }

    return entry.id;
  });
  ipc.handle('terminal:dispose', (_, id) => ptyManager.dispose(id));
  ipc.handle('terminal:resize', (_, id, cols, rows) => ptyManager.resize(id, cols, rows));
  ipc.handle('terminal:write', (_, id, data) => ptyManager.write(id, data));
  ipc.handle('terminal:list', (_) => ptyManager.list());

  const cleanupPtyManager = () => {
    ptyManager.teardown();
    ipcMain.removeHandler('terminal:replay');
    ipcMain.removeHandler('terminal:create');
    ipcMain.removeHandler('terminal:dispose');
    ipcMain.removeHandler('terminal:resize');
    ipcMain.removeHandler('terminal:write');
    ipcMain.removeHandler('terminal:list');
  };

  return [ptyManager, cleanupPtyManager] as const;
};
