import { Button, Flex, Heading } from '@invoke-ai/ui-library';
import { memo } from 'react';
import type { FallbackProps } from 'react-error-boundary';
import { useTranslation } from 'react-i18next';
import { AssertionError } from 'tsafe';

const getMessage = (error: unknown, unknownError: string) => {
  let errorMessage = '';
  if (error instanceof AssertionError) {
    errorMessage = error.originalMessage ?? error.message;
  } else if (error instanceof Error) {
    errorMessage = error.message;
  }
  return errorMessage || unknownError;
};

export const ErrorBoundaryFallback = memo(({ error, resetErrorBoundary }: FallbackProps) => {
  const { t } = useTranslation();
  return (
    <Flex flexDir="column" w="full" h="full" alignItems="center" justifyContent="center" gap={4}>
      <Heading>{t('errorBoundary.title')}</Heading>
      <Heading size="sm" color="error.300">
        {t('errorBoundary.error')}: {getMessage(error, t('errorBoundary.unknownError'))}
      </Heading>
      <Button onClick={resetErrorBoundary} colorScheme="invokeYellow" mt={8}>
        {t('common.reset')}
      </Button>
    </Flex>
  );
});
ErrorBoundaryFallback.displayName = 'ErrorBoundaryFallback';
