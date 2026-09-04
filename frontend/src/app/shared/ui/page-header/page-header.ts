import { Component, input } from '@angular/core';

/**
 * Title + optional description for the top of every feature screen, with a
 * slot for page-level actions (an "add" button, a period selector, ...).
 */
@Component({
  selector: 'app-page-header',
  templateUrl: './page-header.html',
})
export class PageHeader {
  /** Small uppercase label above the title (e.g. a section name). */
  readonly eyebrow = input<string>();
  readonly title = input.required<string>();
  readonly description = input<string>();
}
