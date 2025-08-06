import type { BoxProps, SystemStyleObject } from '@invoke-ai/ui-library';
import { Box, Text } from '@invoke-ai/ui-library';
import Linkify from 'linkify-react';
import type { Opts as LinkifyOpts } from 'linkifyjs';

import { _afterEllipsisKeyframes } from '@/renderer/common/EllipsisLoadingText';

const sx: SystemStyleObject = {
  '&[data-loading="true"]:after': _afterEllipsisKeyframes,
  a: {
    fontWeight: 'semibold',
  },
  'a:hover': {
    textDecoration: 'underline',
  },
};

const linkifyOptions: LinkifyOpts = {
  target: '_blank',
  rel: 'noopener noreferrer',
  validate: (value) => /^https?:\/\//.test(value),
};

type Props = {
  isLoading: boolean;
} & BoxProps;

export const LogViewerStatusIndicator = ({ isLoading, children, ...boxProps }: Props) => {
  return (
    <Box
      bg="base.900"
      borderRadius="base"
      userSelect="none"
      px={3}
      py={1}
      opacity={0.8}
      borderWidth={1}
      shadow="dark-lg"
      {...boxProps}
    >
      <Text sx={sx} data-loading={isLoading}>
        <Linkify options={linkifyOptions}>{children}</Linkify>
      </Text>
    </Box>
  );
};
