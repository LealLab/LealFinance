// Config for @jsverse/transloco-keys-manager (the `transloco-keys-manager`
// CLI — `find` checks for missing/orphaned keys, `extract` generates them).
// Not used at runtime by the app itself; see src/app/core/transloco.providers.ts
// for that.
module.exports = {
  langs: ['pt-BR'],
  rootTranslationsPath: 'public/i18n/',
  keysManager: {
    input: ['src']
  }
};
