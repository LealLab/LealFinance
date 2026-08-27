/**
 * Minimal client-side CSV, no dependency. RFC 4180 quoting plus a guard
 * against spreadsheet formula injection (descriptions are user text landing
 * in Excel), and a UTF-8 BOM so accented headers survive.
 */

const NEEDS_QUOTING = /[",\r\n]/;
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function escapeField(value: string): string {
  // Neutralise a leading =,+,-,@ so Excel/Sheets don't evaluate the cell.
  const guarded = FORMULA_LEAD.test(value) ? `'${value}` : value;
  const mustQuote = guarded !== value || NEEDS_QUOTING.test(guarded) || guarded.trim() !== guarded;
  return mustQuote ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** CRLF line endings (Excel), every row the same width as `headers`. */
export function toCsv(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeField).join(','));
  return lines.join('\r\n');
}

/** Triggers a download of `csv` as `filename` via an object URL. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
