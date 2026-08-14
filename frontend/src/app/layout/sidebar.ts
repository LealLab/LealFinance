import { Component, computed, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { Icon, IconName } from '../shared/ui/icon/icon';

export interface NavItem {
  path: string;
  labelKey: string;
  icon: IconName;
}

export interface NavSection {
  labelKey: string;
  items: NavItem[];
}

/**
 * sidebar.html renders each label by looking up a key stored on this
 * array, which transloco-keys-manager's static extractor can't resolve
 * back to string literals - it would otherwise flag every layout.nav.* key
 * below as orphaned. A JSDoc block is the tool's own escape hatch for
 * exactly this (its TS extractor calls it "dynamic markings"): a bare,
 * unquoted, comma-separated marker call naming every key actually in use.
 * command-palette.ts's "Go to" group reuses these same NavItem entries
 * (and their labelKey values) for its own dynamic label lookup (worded
 * that way, not as a literal call, so this sentence itself doesn't
 * register as a false usage site - see docs/i18n.md's "one gotcha"),
 * so no separate marker is needed there.
 *
 * t(layout.nav.dashboard, layout.nav.accounts, layout.nav.transactions, layout.nav.categories, layout.nav.budgets, layout.nav.goals, layout.nav.reports, layout.nav.settings, layout.nav.sections.accounts, layout.nav.sections.analysis, layout.nav.sections.setup)
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    labelKey: 'layout.nav.sections.accounts',
    items: [
      { path: '/', labelKey: 'layout.nav.dashboard', icon: 'home' },
      { path: '/transactions', labelKey: 'layout.nav.transactions', icon: 'swap' },
      { path: '/accounts', labelKey: 'layout.nav.accounts', icon: 'wallet' },
    ],
  },
  {
    labelKey: 'layout.nav.sections.analysis',
    items: [{ path: '/reports', labelKey: 'layout.nav.reports', icon: 'chart' }],
  },
  {
    labelKey: 'layout.nav.sections.setup',
    items: [
      { path: '/budgets', labelKey: 'layout.nav.budgets', icon: 'piggy' },
      { path: '/goals', labelKey: 'layout.nav.goals', icon: 'target' },
      { path: '/categories', labelKey: 'layout.nav.categories', icon: 'tag' },
      { path: '/settings', labelKey: 'layout.nav.settings', icon: 'settings' },
    ],
  },
];

/**
 * Section nav, shared by the desktop rail and the mobile drawer (Shell
 * decides which chrome wraps it). Icon-only vs. icon+label is handled
 * by the `expanded` input for the desktop rail. The mobile drawer always
 * shows labels and needs a tap on a link to close itself (`navigated`).
 */
@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive, TranslocoDirective, Icon],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
})
export class Sidebar {
  /**
   * 'rail' (default): the persistent desktop sidebar. Its labels follow the
   * `expanded` input so Shell can keep responsive defaults while supporting a
   * manual tablet/desktop toggle.
   * 'drawer': the mobile off-canvas panel - always shows full labels since
   * width isn't a constraint once it's an overlay.
   */
  readonly variant = input<'rail' | 'drawer'>('rail');
  readonly expanded = input(true);
  readonly navigated = output<void>();

  protected readonly navSections = NAV_SECTIONS;
  protected readonly labelClass = computed(() =>
    this.variant() === 'rail' && !this.expanded() ? 'hidden' : '',
  );
  protected readonly sectionLabelClass = computed(() =>
    this.variant() === 'rail' && !this.expanded() ? 'hidden' : 'block',
  );
}
