import { EnvironmentProviders, isDevMode } from '@angular/core';
import { provideTransloco } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import { provideTranslocoPersistLang } from '@jsverse/transloco-persist-lang';

import { HttpTranslocoLoader } from './transloco-loader';

/**
 * English is the default language, while Brazilian Portuguese remains
 * available as an explicit user preference. Locale and currency mappings
 * stay together here so language changes also update Intl formatting.
 */
export function provideAppTransloco(): EnvironmentProviders[] {
  return [
    ...provideTransloco({
      config: {
        availableLangs: ['en-US', 'pt-BR'],
        defaultLang: 'en-US',
        fallbackLang: 'en-US',
        reRenderOnLangChange: true,
        prodMode: !isDevMode()
      },
      loader: HttpTranslocoLoader
    }),
    ...provideTranslocoLocale({
      langToLocaleMapping: {
        'en-US': 'en-US',
        'pt-BR': 'pt-BR'
      },
      localeToCurrencyMapping: {
        'en-US': 'USD',
        'pt-BR': 'BRL'
      }
    }),
    provideTranslocoPersistLang({
      storage: { useValue: localStorage }
    })
  ];
}
