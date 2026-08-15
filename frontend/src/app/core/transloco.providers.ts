import { EnvironmentProviders, isDevMode } from '@angular/core';
import { provideTransloco } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import { provideTranslocoPersistLang } from '@jsverse/transloco-persist-lang';

import { HttpTranslocoLoader } from './transloco-loader';

/**
 * English is the default language. Locale mappings stay together here so
 * language changes also update Intl formatting; display currency remains an
 * independent user preference.
 */
export function provideAppTransloco(): EnvironmentProviders[] {
  return [
    ...provideTransloco({
      config: {
        availableLangs: [
          'en-US',
          'pt-BR',
          'es-ES',
          'fr-FR',
          'de-DE',
          'it-IT',
          'nl-NL',
          'pl-PL',
          'ru-RU',
          'uk-UA',
          'tr-TR',
          'ar',
          'he-IL',
          'hi-IN',
          'zh-CN',
          'zh-TW',
          'ja-JP',
          'ko-KR',
          'id-ID',
          'vi-VN',
          'th-TH',
          'sv-SE',
          'da-DK',
          'nb-NO',
          'fi-FI',
          'cs-CZ',
          'ro-RO',
          'el-GR'
        ],
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
        'pt-BR': 'pt-BR',
        'es-ES': 'es-ES',
        'fr-FR': 'fr-FR',
        'de-DE': 'de-DE',
        'it-IT': 'it-IT',
        'nl-NL': 'nl-NL',
        'pl-PL': 'pl-PL',
        'ru-RU': 'ru-RU',
        'uk-UA': 'uk-UA',
        'tr-TR': 'tr-TR',
        ar: 'ar',
        'he-IL': 'he-IL',
        'hi-IN': 'hi-IN',
        'zh-CN': 'zh-CN',
        'zh-TW': 'zh-TW',
        'ja-JP': 'ja-JP',
        'ko-KR': 'ko-KR',
        'id-ID': 'id-ID',
        'vi-VN': 'vi-VN',
        'th-TH': 'th-TH',
        'sv-SE': 'sv-SE',
        'da-DK': 'da-DK',
        'nb-NO': 'nb-NO',
        'fi-FI': 'fi-FI',
        'cs-CZ': 'cs-CZ',
        'ro-RO': 'ro-RO',
        'el-GR': 'el-GR'
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
