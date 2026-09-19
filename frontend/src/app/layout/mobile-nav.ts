import { computed, inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';
import { MetadataService } from '../core/metadata.service';
import { PreferenceService } from '../core/preference.service';
import { SessionService } from '../core/session.service';
import { IconName } from '../shared/ui/icon/icon';
import { NavItem, NavSection, navSectionsFor } from './sidebar';

/**
 * A bottom-bar destination on phones. Tabs are the nav *sections*; the items
 * inside the active tab are shown as a sub-tab strip under the top bar.
 * `labelKey` values are all listed in the marker block above `NAV_SECTIONS`
 * in sidebar.ts, so the i18n extractor already knows them.
 */
export interface MobileTab {
  labelKey: string;
  icon: IconName;
  items: NavItem[];
}

const SETTINGS_PATH = '/settings';

/**
 * Regroups `navSectionsFor()` output for phones: Settings is pulled out of
 * Setup and becomes its own tab that also hosts the admin pages. Paths,
 * labels, icons and feature/role gating all still come from sidebar.ts, so the
 * desktop rail and the command palette are unaffected.
 */
export function mobileTabsFor(sections: NavSection[]): MobileTab[] {
  const itemsOf = (key: string) => sections.find((s) => s.labelKey === key)?.items ?? [];
  const setup = itemsOf('layout.nav.sections.setup');
  return [
    { labelKey: 'layout.nav.sections.accounts', icon: 'wallet', items: itemsOf('layout.nav.sections.accounts') },
    { labelKey: 'layout.nav.sections.analysis', icon: 'chart', items: itemsOf('layout.nav.sections.analysis') },
    { labelKey: 'layout.nav.sections.setup', icon: 'tools', items: setup.filter((i) => i.path !== SETTINGS_PATH) },
    {
      labelKey: 'layout.nav.settings',
      icon: 'settings',
      items: [...setup.filter((i) => i.path === SETTINGS_PATH), ...itemsOf('layout.nav.sections.admin')],
    },
  ];
}

/**
 * The nav item whose path is the longest prefix of `url` (`/` only matches
 * exactly), so deep routes like `/accounts/42` or `/transactions/import`
 * resolve to their parent item. Undefined for routes with no nav entry
 * (e.g. `/onboarding`).
 */
export function activePathFor(tabs: MobileTab[], url: string): string | undefined {
  const path = url.split(/[?#]/)[0];
  let best: string | undefined;
  for (const { path: candidate } of tabs.flatMap((tab) => tab.items)) {
    const hit = candidate === '/' ? path === '/' : path === candidate || path.startsWith(`${candidate}/`);
    if (hit && (best === undefined || candidate.length > best.length)) best = candidate;
  }
  return best;
}

/** Shared by the bottom bar, the sub-tab strip and the mobile top bar. */
@Injectable({ providedIn: 'root' })
export class MobileNav {
  private readonly router = inject(Router);
  private readonly session = inject(SessionService);
  private readonly metadata = inject(MetadataService);
  private readonly preferences = inject(PreferenceService);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly tabs = computed(() =>
    mobileTabsFor(
      navSectionsFor(
        this.session.user()?.role,
        this.metadata.settings()?.agentsEnabled,
        this.preferences.preferences()?.investmentsEnabled,
        this.session.user()?.aiChatEnabled,
      ),
    ),
  );
  readonly activePath = computed(() => activePathFor(this.tabs(), this.url()));
  readonly activeTab = computed(() => {
    const active = this.activePath();
    return active === undefined
      ? undefined
      : this.tabs().find((tab) => tab.items.some((item) => item.path === active));
  });
}
