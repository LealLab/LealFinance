import { EnvironmentProviders, isDevMode } from '@angular/core';
import { provideTransloco } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import { provideTranslocoPersistLang } from '@jsverse/transloco-persist-lang';

import { HttpTranslocoLoader } from './transloco-loader';

/**
 * LealFinance ships pt-BR only for now (see docs/i18n.md), but every part of
 * this setup — availableLangs, the locale/currency mapping, persistence — is
 * wired as if more languages exist, so adding one later is a config change,
 * not a rewrite.
 */
export function provideAppTransloco(): EnvironmentProviders[] {
  return [
    ...provideTransloco({
      config: {
        availableLangs: ['pt-BR'],
        defaultLang: 'pt-BR',
        fallbackLang: 'pt-BR',
        reRenderOnLangChange: true,
        prodMode: !isDevMode()
      },
      loader: HttpTranslocoLoader
    }),
    ...provideTranslocoLocale({
      langToLocaleMapping: {
        'pt-BR': 'pt-BR'
      },
      localeToCurrencyMapping: {
        'pt-BR': 'BRL'
      }
    }),
    provideTranslocoPersistLang({
      storage: { useValue: localStorage }
    })
  ];
}
