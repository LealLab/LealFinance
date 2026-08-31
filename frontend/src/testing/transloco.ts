/**
 * Shared Transloco configuration for Vitest specs.
 *
 * This is a plain helper imported by individual specs rather than a global
 * setup file, so each spec can choose the catalogs and default language it
 * needs.
 */
import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import ar from '../../public/i18n/ar.json';
import enUS from '../../public/i18n/en-US.json';
import heIL from '../../public/i18n/he-IL.json';
import ptBR from '../../public/i18n/pt-BR.json';

type TestLang = 'pt-BR' | 'en-US' | 'ar' | 'he-IL';

const catalogs = { 'pt-BR': ptBR, 'en-US': enUS, ar, 'he-IL': heIL };

export function provideTestTransloco(langs: TestLang | TestLang[] = 'pt-BR') {
  const selectedLangs = Array.isArray(langs) ? langs : [langs];

  return TranslocoTestingModule.forRoot({
    langs: Object.fromEntries(selectedLangs.map((lang) => [lang, catalogs[lang]])),
    translocoConfig: { availableLangs: selectedLangs, defaultLang: selectedLangs[0] }
  });
}

export function provideTestTranslocoLocale(lang: TestLang = 'pt-BR') {
  return provideTranslocoLocale({
    defaultLocale: lang,
    defaultCurrency: lang === 'pt-BR' ? 'BRL' : 'USD'
  });
}
