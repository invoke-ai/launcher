import { FormControl, FormLabel, Select } from '@invoke-ai/ui-library';
import { useStore } from '@nanostores/react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { LANGUAGES } from '@/renderer/i18n';
import { persistedStoreApi } from '@/renderer/services/store';
import type { LanguageCode } from '@/shared/types';

export const SettingsModalLanguage = memo(() => {
  const { t } = useTranslation();
  const { language } = useStore(persistedStoreApi.$atom);
  const onChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    void persistedStoreApi.setKey('language', e.target.value as LanguageCode);
  }, []);

  return (
    <FormControl orientation="vertical">
      <FormLabel>{t('settings.language')}</FormLabel>
      <Select value={language} onChange={onChange} w="min-content">
        {LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.native}
          </option>
        ))}
      </Select>
    </FormControl>
  );
});
SettingsModalLanguage.displayName = 'SettingsModalLanguage';
