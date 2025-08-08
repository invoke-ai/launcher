import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { atom, computed, onMount, task } from 'nanostores';

import { DEFAULT_XTERM_OPTIONS } from '@/renderer/constants';
import { emitter, ipc } from '@/renderer/services/ipc';

// const DEFAULT_XTERM_OPTIONS: ITerminalOptions & ITerminalInitOnlyOptions = {
//   cursorBlink: true,
//   fontSize: TERMINAL_FONT_SIZE,
//   fontFamily: TERMINAL_FONT,
//   scrollback: 5_000,
//   allowTransparency: true,
//   convertEol: true, // Convert \n to \r\n
// };

type BaseXtermState = {
  id: string;
  xterm: Terminal;
  fitAddon: FitAddon;
  hasNewOutput: boolean;
};

export type TerminalState =
  | (BaseXtermState & {
      isRunning: true;
    })
  | (BaseXtermState & {
      isRunning: false;
      exitCode: number;
    });

export const $isConsoleOpen = atom(false);
export const $terminal = atom<TerminalState | null>(null);

$isConsoleOpen.listen((isConsoleOpen) => {
  const terminal = $terminal.get();
  if (isConsoleOpen && terminal) {
    $terminal.set({ ...terminal, hasNewOutput: false });
    terminal.fitAddon.fit();
  }
});

onMount($terminal, () => {
  task(async () => {
    const terminalIds = await emitter.invoke('terminal:list');
    const [id, ...rest] = terminalIds;
    if (rest.length > 0) {
      console.warn(
        `Multiple terminals are not supported. Only the first terminal will be opened.
        Disposing ${rest.length} other terminal(s).`
      );
      await Promise.allSettled(rest.map((id) => emitter.invoke('terminal:dispose', id)));
    }

    if (!id) {
      return;
    }

    console.debug('Attaching to terminal', id);
    attachTerminal(id);
  });
});

const attachTerminal = async (id: string) => {
  const data = await emitter.invoke('terminal:replay', id);
  const terminal = buildTerminalState(id, data);
  $terminal.set(terminal);
};

export const destroyTerminal = async () => {
  const terminal = $terminal.get();
  if (!terminal) {
    console.warn('Terminal not found');
    return;
  }
  await emitter.invoke('terminal:dispose', terminal.id);
  terminal.xterm.dispose();
  $terminal.set(null);
  $isConsoleOpen.set(false);
};

export const initializeTerminal = async (cwd?: string) => {
  const terminal = $terminal.get();
  if (terminal) {
    console.warn('Disposing terminal', terminal.id);
    await emitter.invoke('terminal:dispose', terminal.id);
    terminal.xterm.dispose();
  }
  const id = await emitter.invoke('terminal:create', cwd);
  $terminal.set(buildTerminalState(id));
};

const buildTerminalState = (id: string, data?: string | null): TerminalState => {
  const xterm = new Terminal({ ...DEFAULT_XTERM_OPTIONS, cursorBlink: true });
  xterm.onData((data) => {
    emitter.invoke('terminal:write', id, data);
  });
  xterm.onResize(({ cols, rows }) => {
    emitter.invoke('terminal:resize', id, cols, rows);
  });

  const fitAddon = new FitAddon();
  xterm.loadAddon(fitAddon);

  if (data) {
    xterm.write(data);
  }
  return {
    id,
    isRunning: true,
    hasNewOutput: false,
    xterm,
    fitAddon,
  };
};

const doWithTerminal = (id: string, fn: (terminal: TerminalState) => void) => {
  const terminal = $terminal.get();
  if (!terminal || terminal.id !== id) {
    console.warn(`Terminal ${id} not found`);
    return;
  }
  fn(terminal);
};

ipc.on('terminal:exited', (_, id, exitCode) => {
  doWithTerminal(id, (terminal) => {
    terminal.xterm.options.disableStdin = true;
    $terminal.set({ ...terminal, isRunning: false, exitCode, hasNewOutput: !$isConsoleOpen.get() });
  });
});

ipc.on('terminal:output', (_, id, data) => {
  doWithTerminal(id, (terminal) => {
    terminal.xterm.write(data);
    if (!$isConsoleOpen.get()) {
      $terminal.set({ ...terminal, hasNewOutput: true });
    }
  });
});

export const $terminalHasNewOutput = computed([$terminal], (terminal) => {
  return terminal && terminal.hasNewOutput;
});
