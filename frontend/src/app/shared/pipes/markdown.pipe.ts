import { Pipe, PipeTransform } from '@angular/core';
import { marked } from 'marked';

/**
 * Renders a trusted-source markdown string to an HTML string for
 * `[innerHTML]`. Used for AI assistant replies, which come back as GitHub
 * flavoured markdown.
 *
 * No explicit HTML sanitiser is wired in: the only consumer binds the
 * result through Angular's `[innerHTML]`, whose built-in `DomSanitizer`
 * strips `<script>`, event handlers, and `javascript:` URLs. `breaks: true`
 * turns a single newline into `<br>` so chat replies keep their line
 * breaks without needing blank lines.
 */
@Pipe({ name: 'markdown' })
export class MarkdownPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) return '';
    return marked.parse(value, { async: false, gfm: true, breaks: true }) as string;
  }
}
