import '@xterm/xterm/css/xterm.css';

import { Box, IconButton } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import { debounce } from 'es-toolkit/compat';
import type { Atom } from 'nanostores';
import type { PropsWithChildren } from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { PiCaretDownBold } from 'react-icons/pi';

import { $XTERM_THEME } from '@/renderer/constants';

const getIsAtBottom: (terminal: Terminal) => boolean = (terminal) => {
  const viewport = terminal.buffer.active.viewportY;
  const scrollback = terminal.buffer.active.length;
  const isAtBottom = viewport === scrollback - terminal.rows;
  return isAtBottom;
};

export const XTermLogViewer = memo(({ children, $xterm }: PropsWithChildren<{ $xterm: Atom<Terminal | null> }>) => {
  const xterm = useStore($xterm);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  useEffect(() => {
    const el = containerRef.current;
    const parent = el?.parentElement;

    if (!el || !parent || !xterm) {
      console.log('no el or parent');
      return;
    }

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.options.theme = $XTERM_THEME.get();

    // Use longer debounce to avoid interfering with progress bar updates
    const debouncedFit = debounce(
      () => {
        fitAddon.fit();
      },
      300,
      { leading: true, trailing: true }
    );
    const resizeObserver = new ResizeObserver(debouncedFit);
    resizeObserver.observe(parent);

    const onWheel = () => {
      setIsAtBottom(getIsAtBottom(xterm));
    };

    el.addEventListener('wheel', onWheel);

    xterm.open(el);
    fitAddon.fit();

    return () => {
      resizeObserver.disconnect();
      el.removeEventListener('wheel', onWheel);
    };
  }, [xterm]);

  const onClickScrollToBottom = useCallback(() => {
    const xterm = $xterm.get();
    if (!xterm) {
      return;
    }
    xterm.scrollToBottom();
  }, [$xterm]);

  return (
    <Box position="relative" w="full" h="full" borderWidth={1} borderRadius="base" overflow="hidden">
      <Box ref={containerRef} position="absolute" inset={2} />
      {children}
      {!isAtBottom && (
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

XTermLogViewer.displayName = 'XTermLogViewer';
