import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { Icon } from '../shared/ui/icon/icon';
import { MobileNav } from './mobile-nav';

/**
 * Phone-only bottom tab bar (hidden from `md` up, where the sidebar takes
 * over). One tab per nav section; tapping a tab opens its first item and the
 * rest of the section is reached through the sub-tab strip (section-tabs.ts).
 */
@Component({
  selector: 'app-bottom-nav',
  imports: [RouterLink, TranslocoDirective, Icon],
  templateUrl: './bottom-nav.html',
  styleUrl: './bottom-nav.scss',
})
export class BottomNav {
  protected readonly nav = inject(MobileNav);
}
