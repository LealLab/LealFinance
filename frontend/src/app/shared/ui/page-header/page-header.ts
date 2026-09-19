import { Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';
import { isSectionRootUrl } from '../../../layout/mobile-nav';

/**
 * Title + optional description for the top of every feature screen, with a
 * slot for page-level actions (an "add" button, a period selector, ...).
 *
 * On phones the shell's top bar and section strip already name a page that is
 * a nav item, so the heading is visually hidden there (still read by screen
 * readers) and the actions get the full row.
 */
@Component({
  selector: 'app-page-header',
  templateUrl: './page-header.html',
})
export class PageHeader {
  private readonly router = inject(Router);

  /** Small uppercase label above the title (e.g. a section name). */
  readonly eyebrow = input<string>();
  readonly title = input.required<string>();
  readonly description = input<string>();

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected readonly headingClass = computed(() =>
    isSectionRootUrl(this.url())
      ? 'flex flex-col gap-1 sr-only md:not-sr-only'
      : 'flex flex-col gap-1',
  );
}
