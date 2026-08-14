/**
 * Small hand-rolled fuzzy matcher for the command palette - no library, no
 * PaletteItem awareness, just string in, string out. Diacritics are
 * stripped and both strings lowercased before comparing, so a query typed
 * without accents ("alimentacao") still matches accented data
 * ("Alimentação"), and vice versa.
 *
 * Convention: higher score = better match, `-1` = no match at all (query
 * isn't even a subsequence of text). Two tiers:
 *  - A literal substring match scores highest, and earlier/prefix
 *    occurrences score higher than ones buried later in the string.
 *  - Failing that, a subsequence match (every query character appears in
 *    order, not necessarily contiguous) still scores, with a bonus for
 *    runs of consecutive matching characters - "wal" matching "Wallet"
 *    contiguously should outscore "wal" matching scattered letters in a
 *    longer string.
 */
// Combining Diacritical Marks block (U+0300-U+036F) - stripped after NFD
// decomposition so "ç"/"ã"/"õ" etc. reduce to their bare base letter. Built
// as a codepoint range check rather than a `̀-ͯ` regex literal
// only to sidestep escape-sequence mangling through this file's edit
// tooling; the two are equivalent.
const COMBINING_MARK_START = 0x0300;
const COMBINING_MARK_END = 0x036f;

function normalize(value: string): string {
  const decomposed = value.normalize('NFD');
  let result = '';
  for (const char of decomposed) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= COMBINING_MARK_START && code <= COMBINING_MARK_END) continue;
    result += char;
  }
  return result.toLowerCase();
}

export function fuzzyScore(query: string, text: string): number {
  const q = normalize(query.trim());
  const t = normalize(text);

  if (q.length === 0) return 0;
  if (t.length === 0) return -1;

  const substringIndex = t.indexOf(q);
  if (substringIndex >= 0) {
    const prefixBonus = substringIndex === 0 ? 20 : 0;
    return 100 - substringIndex + prefixBonus;
  }

  let queryIndex = 0;
  let score = 0;
  let run = 0;
  let lastMatchIndex = -1;

  for (let textIndex = 0; textIndex < t.length && queryIndex < q.length; textIndex++) {
    if (t[textIndex] !== q[queryIndex]) continue;

    run = lastMatchIndex === textIndex - 1 ? run + 1 : 1;
    score += run;
    lastMatchIndex = textIndex;
    queryIndex += 1;
  }

  return queryIndex === q.length ? score : -1;
}
