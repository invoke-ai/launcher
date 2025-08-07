import type { SystemStyleObject } from '@invoke-ai/ui-library';
import { Box, IconButton, Text } from '@invoke-ai/ui-library';
import Linkify from 'linkify-react';
import type { Opts as LinkifyOpts } from 'linkifyjs';
import type { PropsWithChildren } from 'react';
import { memo, useCallback, useRef, useState } from 'react';
import { PiCaretDownBold } from 'react-icons/pi';
import type { ItemContent, VirtuosoHandle } from 'react-virtuoso';
import { Virtuoso } from 'react-virtuoso';
import { assert } from 'tsafe';

import type { LogEntry, WithTimestamp } from '@/shared/types';

const getKey = (entry: WithTimestamp<LogEntry>, index: number) => `${entry.timestamp}-${index}`;

// Styles for log entries and links in them
const sx: SystemStyleObject = {
  '[data-level="debug"]': {
    color: 'invokeBlue.200',
    a: {
      color: 'invokeBlue.100',
    },
  },
  '[data-level="info"]': {
    color: 'base.200',
    a: {
      color: 'base.100',
    },
  },
  '[data-level="warn"]': {
    color: 'warning.200',
    a: {
      color: 'warning.100',
    },
  },
  '[data-level="error"]': {
    color: 'error.200',
    a: {
      color: 'error.100',
    },
  },
  a: {
    fontWeight: 'extrabold',
  },
  'a:hover': {
    textDecoration: 'underline',
  },
};

const virtuosoStyle = { height: '100%' };

const itemContent: ItemContent<WithTimestamp<LogEntry>, void> = (i, data) => {
  const k = getKey(data, i);
  switch (data.level) {
    case 'debug':
      return <LogEntryDebug key={k} entry={data} />;
    case 'info':
      return <LogEntryInfo key={k} entry={data} />;
    case 'warn':
      return <LogEntryWarn key={k} entry={data} />;
    case 'error':
      return <LogEntryError key={k} entry={data} />;
    default:
      assert(false, 'Invalid log level');
  }
};

export const LogViewer = memo(({ logs, children }: PropsWithChildren<{ logs: WithTimestamp<LogEntry>[] }>) => {
  const [isAtBottom, setIsAtBottom] = useState(false);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const onAtBottomStateChange = useCallback((isAtBottom: boolean) => {
    setIsAtBottom(isAtBottom);
  }, []);

  const onClickScrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollBy({ top: Number.MAX_SAFE_INTEGER, behavior: 'smooth' });
  }, []);

  return (
    <Box position="relative" w="full" h="full" borderWidth={1} borderRadius="base">
      <Box position="absolute" inset={2} overflow="auto" sx={sx}>
        <Virtuoso
          ref={virtuosoRef}
          data={logs}
          itemContent={itemContent}
          style={virtuosoStyle}
          overscan={200}
          followOutput
          atBottomStateChange={onAtBottomStateChange}
        />
      </Box>
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
LogViewer.displayName = 'LogViewer';

const linkifyOptions: LinkifyOpts = {
  target: '_blank',
  rel: 'noopener noreferrer',
  validate: (value) => /^https?:\/\//.test(value),
};

const MIN_H = 6; // equivalent to base line height
const FONT_FAMILY = '"JetBrainsMonoNerdFont"';

const LogEntryDebug = ({ entry }: { entry: WithTimestamp<LogEntry> }) => {
  return (
    <Text as="pre" minH={MIN_H} fontFamily={FONT_FAMILY} color="invokeBlue.200" data-level="debug">
      <Linkify options={linkifyOptions}>{entry.message}</Linkify>
    </Text>
  );
};
const LogEntryInfo = ({ entry }: { entry: WithTimestamp<LogEntry> }) => {
  return (
    <Text as="pre" minH={MIN_H} fontFamily={FONT_FAMILY} color="base.200" data-level="info">
      <Linkify options={linkifyOptions}>{entry.message}</Linkify>
    </Text>
  );
};
const LogEntryWarn = ({ entry }: { entry: WithTimestamp<LogEntry> }) => {
  return (
    <Text as="pre" minH={MIN_H} fontFamily={FONT_FAMILY} color="warning.200" data-level="warn">
      <Linkify options={linkifyOptions}>{entry.message}</Linkify>
    </Text>
  );
};
const LogEntryError = ({ entry }: { entry: WithTimestamp<LogEntry> }) => {
  return (
    <Text as="pre" minH={MIN_H} fontFamily={FONT_FAMILY} color="error.200" data-level="error">
      <Linkify options={linkifyOptions}>{entry.message}</Linkify>
    </Text>
  );
};
