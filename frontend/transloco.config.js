// Config for @jsverse/transloco-keys-manager (the `transloco-keys-manager`
// CLI - `find` checks for missing/orphaned keys, `extract` generates them).
// Not used at runtime by the app itself; see src/app/core/transloco.providers.ts
// for that.
module.exports = {
  langs: [
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
  rootTranslationsPath: 'public/i18n/',
  keysManager: {
    input: ['src']
  }
};
