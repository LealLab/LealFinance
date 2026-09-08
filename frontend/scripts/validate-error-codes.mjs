import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = path.join(frontendDir, '..', 'backend', 'app');
const catalogPath = path.join(frontendDir, 'public', 'i18n', 'en-US.json');

const allowlist = new Set([
  'error.generic',
  'error.validation',
  'backup.invalid_file_type',
  'import.row.invalid_amount',
  'import.row.invalid_date',
  'import.row.missing_description',
  'import.row.zero_amount',
  'agents.instructions_rejected',
  'agents.suggest_unreadable',
]);

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const current = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(current) : [current];
  });
}

function flatten(value, prefix = '') {
  if (typeof value === 'string') return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  );
}

const emitted = new Set();
const codeLiteral = /\bcode\s*[:=]\s*(['"])([A-Za-z][A-Za-z0-9_-]*\.[A-Za-z0-9_.-]+)\1/g;
const errorPrefix = /__error_prefix__\s*=\s*(['"])([A-Za-z][A-Za-z0-9_-]*)\1/g;
for (const file of filesUnder(backendDir).filter((file) => file.endsWith('.py'))) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(codeLiteral)) emitted.add(match[2]);
  for (const match of source.matchAll(errorPrefix)) emitted.add(`${match[2]}.not_found`);
}

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const catalogKeys = new Set(flatten(catalog.errors));
const missing = [...emitted].filter((code) => !catalogKeys.has(code)).sort();
const orphaned = [...catalogKeys]
  .filter((code) => !emitted.has(code) && !allowlist.has(code))
  .sort();

if (missing.length) {
  console.log(`WARN: backend error codes without catalog keys: ${missing.join(', ')}`);
}
if (orphaned.length) {
  console.error(`ERROR: orphaned catalog error keys: ${orphaned.join(', ')}`);
}

console.log(
  `Error-code validation: emitted=${emitted.size}, catalog=${catalogKeys.size}, missing=${missing.length}, orphaned=${orphaned.length}`,
);
if (orphaned.length) process.exitCode = 1;
