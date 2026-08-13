import { Component, input } from '@angular/core';

/**
 * Title + optional description for the top of every feature screen, with a
 * slot for page-level actions (an "add" button, a period selector, ...).
 */
@Component({
  selector: 'app-page-header',
  templateUrl: './page-header.html',
  styleUrl: './page-header.scss'
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly description = input<string>();
}
