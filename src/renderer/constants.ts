import type { ITerminalInitOnlyOptions, ITerminalOptions, ITheme } from '@xterm/xterm';
import { atom } from 'nanostores';

/**
 * The interval in milliseconds to poll the status of a process. Used for the main, install and invoke processes.
 */
export const STATUS_POLL_INTERVAL_MS = 1_000;

export const TERMINAL_FONT = 'JetBrainsMonoNerdFont';
export const TERMINAL_FONT_SIZE = 12;

export const DEFAULT_XTERM_OPTIONS: ITerminalOptions & ITerminalInitOnlyOptions = {
  cursorBlink: false,
  cursorStyle: 'block',
  fontSize: TERMINAL_FONT_SIZE,
  fontFamily: TERMINAL_FONT,
  scrollback: 5_000,
  allowTransparency: true,
};

const getCssVar = (token: string): string => {
  // given a token like 'base.300', return the CSS variable '--invoke-colors-base-300'
  const [color, number] = token.split('.');
  return `--invoke-colors-${color}-${number}`;
};

const getRawValue = (token: string): string => {
  const cssVar = getCssVar(token);
  return getComputedStyle(document.documentElement).getPropertyValue(cssVar);
};

export const $XTERM_THEME = atom<ITheme>({});

export const syncTheme = () => {
  $XTERM_THEME.set({
    background: 'rgba(0, 0, 0, 0)',
    foreground: getRawValue('base.100'),
    black: getRawValue('base.100'),
    brightBlack: getRawValue('base.100'),
    white: getRawValue('base.950'),
    brightWhite: getRawValue('base.950'),
    cursor: getRawValue('base.100'),
    cursorAccent: getRawValue('bas.e50'),
    blue: getRawValue('invokeBlue.300'),
    brightBlue: getRawValue('invokeBlue.300'),
    cyan: getRawValue('teal.300'),
    brightCyan: getRawValue('teal.300'),
    green: getRawValue('invokeGreen.300'),
    brightGreen: getRawValue('invokeGreen.300'),
    yellow: getRawValue('invokeYellow.300'),
    brightYellow: getRawValue('invokeYellow.300'),
    red: getRawValue('invokeRed.300'),
    brightRed: getRawValue('invokeRed.300'),
    magenta: getRawValue('invokePurple.300'),
    brightMagenta: getRawValue('invokePurple.300'),
  });
};
