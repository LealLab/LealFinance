/**
 * Detects a Mac so the command-palette trigger can show the ⌘K hint macOS
 * users expect instead of Ctrl K. No precedent for platform-sniffing
 * elsewhere in this app (there's been no reason to branch on OS before),
 * so this is deliberately small: `navigator.userAgentData.platform` where
 * available (Chromium), falling back to the long-deprecated but still
 * universally-supported `navigator.platform`, then `navigator.userAgent`
 * as a last resort for browsers exposing neither.
 */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;

  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const source = uaData?.platform || navigator.platform || navigator.userAgent || '';

  return /mac/i.test(source);
}
