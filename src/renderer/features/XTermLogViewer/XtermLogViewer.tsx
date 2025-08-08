import '@xterm/xterm/css/xterm.css';

import { Box, IconButton } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { FitAddon } from '@xterm/addon-fit';
import type { ITerminalInitOnlyOptions, ITerminalOptions } from '@xterm/xterm';
import { Terminal } from '@xterm/xterm';
import { debounce } from 'es-toolkit/compat';
import type { WritableAtom } from 'nanostores';
import type { PropsWithChildren } from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { PiCaretDownBold } from 'react-icons/pi';

import { TERMINAL_FONT, TERMINAL_FONT_SIZE } from '@/renderer/constants';
import { useXTermTheme } from '@/renderer/features/Console/use-xterm-theme';

const DEFAULT_XTERM_OPTIONS: ITerminalOptions & ITerminalInitOnlyOptions = {
  cursorBlink: false,
  cursorStyle: 'block',
  fontSize: TERMINAL_FONT_SIZE,
  fontFamily: TERMINAL_FONT,
  scrollback: 5_000,
  allowTransparency: true,
  disableStdin: true, // Read-only terminal
  convertEol: true, // Convert \n to \r\n
};

interface XtermLogViewerProps {
  $terminal: WritableAtom<{ terminal: Terminal; fitAddon: FitAddon } | null>;
}

const getIsAtBottom: (terminal: Terminal) => boolean = (terminal) => {
  const viewport = terminal.buffer.active.viewportY;
  const scrollback = terminal.buffer.active.length;
  const isAtBottom = viewport === scrollback - terminal.rows;
  return isAtBottom;
};

export const XtermLogViewer = memo(({ children, $terminal }: PropsWithChildren<XtermLogViewerProps>) => {
  const theme = useXTermTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const terminal = useStore($terminal);

  // Initialize terminal if not provided
  useEffect(() => {
    const el = containerRef.current;
    const parent = el?.parentElement;

    if (!el || !parent) {
      return;
    }

    if ($terminal.get()) {
      return;
    }

    const terminal = new Terminal(DEFAULT_XTERM_OPTIONS);
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.options.theme = theme;

    $terminal.set({ terminal, fitAddon });
    const debouncedFit = debounce(
      () => {
        fitAddon.fit();
      },
      300,
      { leading: false, trailing: true }
    );
    const resizeObserver = new ResizeObserver(debouncedFit);
    resizeObserver.observe(parent);

    const onWheel = () => {
      setIsAtBottom(getIsAtBottom(terminal));
    };

    el.addEventListener('wheel', onWheel);

    // Open terminal in container
    terminal.open(el);
    debouncedFit();

    return () => {
      resizeObserver.disconnect();
      el.removeEventListener('wheel', onWheel);
      terminal.dispose();
      $terminal.set(null);
    };
  }, [$terminal, theme]);

  const onClickScrollToBottom = useCallback(() => {
    if (terminal) {
      terminal.terminal.scrollToBottom();
    }
  }, [terminal]);

  return (
    <Box position="relative" w="full" h="full" borderWidth={1} borderRadius="base">
      <Box ref={containerRef} position="absolute" inset={2} />
      {children}
      {!isAtBottom && terminal && (
        <IconButton
          variant="ghost"
          aria-label="Scroll to Bottom"
          icon={<PiCaretDownBold />}
          position="absolute"
          bottom={2}
          right={2}
          onClick={onClickScrollToBottom}
        />
      )}
    </Box>
  );
});

XtermLogViewer.displayName = 'XtermLogViewer';
