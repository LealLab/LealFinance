import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const locales = [
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
  'el-GR',
];

const translationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'i18n',
);

function load(locale) {
  const file = path.join(translationsDir, `${locale}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function leaves(value, prefix = '') {
  if (typeof value === 'string') return [[prefix, value]];
  return Object.entries(value).flatMap(([key, child]) =>
    leaves(child, prefix ? `${prefix}.${key}` : key),
  );
}

function placeholders(value) {
  return [...value.matchAll(/\{\{[^}]+\}\}/g)].map(([match]) => match).sort();
}

const baseLeaves = leaves(load('en-US'));
const baseByKey = new Map(baseLeaves);
const expectedFiles = new Set(locales.map((locale) => `${locale}.json`));
const actualFiles = new Set(fs.readdirSync(translationsDir).filter((file) => file.endsWith('.json')));
const unexpectedFiles = [...actualFiles].filter((file) => !expectedFiles.has(file));
const missingFiles = [...expectedFiles].filter((file) => !actualFiles.has(file));

if (missingFiles.length || unexpectedFiles.length) {
  throw new Error(
    `Locale files mismatch. Missing: ${missingFiles.join(', ') || 'none'}; unexpected: ${unexpectedFiles.join(', ') || 'none'}`,
  );
}

for (const locale of locales) {
  const current = leaves(load(locale));
  const currentByKey = new Map(current);
  const missingKeys = [...baseByKey.keys()].filter((key) => !currentByKey.has(key));
  const extraKeys = [...currentByKey.keys()].filter((key) => !baseByKey.has(key));
  const placeholderMismatches = [...baseByKey.keys()].filter(
    (key) =>
      currentByKey.has(key) &&
      JSON.stringify(placeholders(baseByKey.get(key))) !==
        JSON.stringify(placeholders(currentByKey.get(key))),
  );
  const emptyValues = current.filter(([, value]) => value.trim() === '').map(([key]) => key);

  if (missingKeys.length || extraKeys.length || placeholderMismatches.length || emptyValues.length) {
    throw new Error(
      `${locale} invalid: missing=${missingKeys.length}, extra=${extraKeys.length}, placeholders=${placeholderMismatches.length}, empty=${emptyValues.length}`,
    );
  }
}

console.log(`Validated ${locales.length} locale catalogs with ${baseLeaves.length} string keys.`);
