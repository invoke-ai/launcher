import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useStore } from '@nanostores/react';
import { I18nextProvider } from 'react-i18next';

import { App } from '@/renderer/app/App';
import i18n, { setupI18n } from '@/renderer/i18n';
import { persistedStoreApi } from '@/renderer/services/store';

const InnerApp = () => {
  const { language } = useStore(persistedStoreApi.$atom);

  useEffect(() => {
    i18n.changeLanguage(language);
    document.documentElement.dir = language === 'ar' || language === 'he' ? 'rtl' : 'ltr';
  }, [language]);

  return <App key={language} />;
};

setupI18n(persistedStoreApi.getKey('language'));

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <InnerApp />
    </I18nextProvider>
  </StrictMode>
);
