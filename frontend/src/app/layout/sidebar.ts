import { Component, computed, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { Icon, IconName } from '../shared/ui/icon/icon';

interface NavItem {
  path: string;
  labelKey: string;
  icon: IconName;
}

/**
 * sidebar.html renders each label by looking up a key stored on this
 * array, which transloco-keys-manager's static extractor can't resolve
 * back to string literals — it would otherwise flag every layout.nav.* key
 * below as orphaned. A JSDoc block is the tool's own escape hatch for
 * exactly this (its TS extractor calls it "dynamic markings"): a bare,
 * unquoted, comma-separated marker call naming every key actually in use.
 *
 * t(layout.nav.dashboard, layout.nav.accounts, layout.nav.transactions, layout.nav.categories, layout.nav.budgets, layout.nav.reports, layout.nav.settings)
 */
const NAV_ITEMS: NavItem[] = [
  { path: '/', labelKey: 'layout.nav.dashboard', icon: 'home' },
  { path: '/accounts', labelKey: 'layout.nav.accounts', icon: 'wallet' },
  { path: '/transactions', labelKey: 'layout.nav.transactions', icon: 'swap' },
  { path: '/categories', labelKey: 'layout.nav.categories', icon: 'tag' },
  { path: '/budgets', labelKey: 'layout.nav.budgets', icon: 'target' },
  { path: '/reports', labelKey: 'layout.nav.reports', icon: 'chart' },
  { path: '/settings', labelKey: 'layout.nav.settings', icon: 'settings' }
];

/**
 * Section nav, shared by the desktop rail and the mobile drawer (Shell
 * decides which chrome wraps it). Icon-only vs. icon+label is handled
 * entirely by responsive Tailwind classes in sidebar.html — no JS
 * collapse state — except inside the mobile drawer, which always shows
 * labels and needs a tap on a link to close itself (`navigated`).
 */
@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive, TranslocoDirective, Icon],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss'
})
export class Sidebar {
  /**
   * 'rail' (default): the persistent desktop sidebar — labels collapse to
   * icon-only between `md` and `lg` so the rail stays narrow on tablets.
   * 'drawer': the mobile off-canvas panel — always shows full labels since
   * width isn't a constraint once it's an overlay.
   */
  readonly variant = input<'rail' | 'drawer'>('rail');
  readonly navigated = output<void>();

  protected readonly navItems = NAV_ITEMS;
  protected readonly labelClass = computed(() =>
    this.variant() === 'rail' ? 'md:hidden lg:inline' : ''
  );
}
