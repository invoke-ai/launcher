import { Button, Flex, Grid, GridItem } from '@invoke-ai/ui-library';
import type { ReactNode } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { assert } from 'tsafe';

import { BannerInvokeLogoTag } from '@/renderer/features/Banner/BannerInvokeLogoTag';
import { SettingsModalOpenButton } from '@/renderer/features/SettingsModal/SettingsModalOpenButton';

// TODO(psyche): make this dynamic so we don't need to keep it synced with the package.json version
const VERSION = '1.2.1';

const MIN_PROBABILITY = 0.2;

const getRand = (seed: number) => {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
};

const shouldBeYellow = (colIndex: number, totalCols: number, rand: () => number): boolean => {
  const probability = MIN_PROBABILITY + (colIndex / (totalCols - 2)) * (1 - MIN_PROBABILITY);
  return rand() < probability;
};

const getTemplateString = (num: number, unit: string) => {
  return Array.from({ length: num }, () => unit).join(' ');
};

const getGrid = (width: number, height: number, size: number, rand: () => number) => {
  const cols = width / size;
  const rows = height / size;
  assert(cols % 1 === 0);
  assert(rows % 1 === 0);

  const props = {
    w: `${width}px`,
    h: `${height}px`,
    gridTemplateColumns: getTemplateString(cols, '1fr'),
    gridTemplateRows: getTemplateString(rows, '1fr'),
  };

  const children: ReactNode[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = r * cols + c;
      const bg = shouldBeYellow(c, cols, rand) ? 'invokeYellow.500' : undefined;
      children.push(<GridItem key={key} bg={bg} />);
    }
  }

  return { props, children } as const;
};

const INITIAL_SEED = 1406667833; // experimentally determined

const getSeed = () => Math.floor(Math.random() * 2147483647);

export const Banner = memo(() => {
  const [seed, setSeed] = useState(INITIAL_SEED);

  const rand = useMemo(() => getRand(seed), [seed]);
  const grid = useMemo(() => getGrid(360, 120, 40, rand), [rand]);

  const reroll = useCallback(() => {
    const seed = getSeed();
    setSeed(seed);
  }, []);

  return (
    <Grid position="relative" w="full" h="120px" gridTemplateColumns="440px auto">
      <GridItem display="flex" alignItems="center" justifyContent="center">
        <BannerInvokeLogoTag width="full" h="120px" />
      </GridItem>
      <GridItem as={Flex} position="relative" justifyContent="flex-end">
        <Grid {...grid.props}>{grid.children}</Grid>
        <Button onClick={reroll} variant="unstyled" position="absolute" top="0" right="2" size="sm" color="base.700">
          {`v${VERSION}`}
        </Button>
      </GridItem>
      <SettingsModalOpenButton position="absolute" insetBlockStart={3} insetInlineStart={3} />
    </Grid>
  );
});
Banner.displayName = 'Banner';
