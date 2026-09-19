import { afterRenderEffect, Component, ElementRef, inject, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { MobileNav } from './mobile-nav';

/**
 * Phone-only strip listing the pages inside the active bottom-bar tab. It
 * scrolls horizontally (Setup has six pages) and keeps the current page in
 * view after each navigation.
 */
@Component({
  selector: 'app-section-tabs',
  imports: [RouterLink, TranslocoDirective],
  templateUrl: './section-tabs.html',
  styleUrl: './section-tabs.scss',
})
export class SectionTabs {
  protected readonly nav = inject(MobileNav);
  private readonly strip = viewChild<ElementRef<HTMLElement>>('strip');

  constructor() {
    afterRenderEffect(() => {
      this.nav.activePath();
      const current = this.strip()?.nativeElement.querySelector('[aria-current="page"]');
      // scrollIntoView is missing in jsdom.
      current?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
    });
  }
}
