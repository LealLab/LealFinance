import {
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { BalanceVisibilityService } from '../core/balance-visibility.service';
import { CommandPaletteService } from '../core/command-palette.service';
import { MetadataService } from '../core/metadata.service';
import { isMacPlatform } from '../core/platform';
import { PreferenceService } from '../core/preference.service';
import { SessionService } from '../core/session.service';
import { userInitials } from '../core/identity.models';
import { MutationErrorService } from '../core/mutation-error.service';
import { Button } from '../shared/ui/button/button';
import { ConfirmDialog } from '../shared/ui/confirm-dialog/confirm-dialog';
import { Icon } from '../shared/ui/icon/icon';
import { LanguageSelect } from '../shared/ui/language-select/language-select';
import { Logo } from '../shared/ui/logo/logo';
import { ThemeToggle } from '../shared/ui/theme-toggle/theme-toggle';
import { CommandPalette } from './command-palette/command-palette';
import { BottomNav } from './bottom-nav';
import { MobileNav } from './mobile-nav';
import { SectionTabs } from './section-tabs';
import { Sidebar } from './sidebar';
import { UpdateBanner } from './update-banner/update-banner';

/**
 * App shell: a persistent sidebar on `md+` screens (icon rail from `md` to
 * `lg`, full labels from `lg` up - see sidebar.ts). Below `md` it behaves like
 * a phone app instead: a slim top bar (section name, search, balance toggle,
 * menu), a sub-tab strip for the pages in the active section, and a bottom
 * tab bar with one tab per section (see mobile-nav.ts). The menu button
 * still opens the off-canvas drawer, which holds the full nav plus theme,
 * language and logout. Theme/language controls are
 * `app-theme-toggle`/`app-language-select` (shared/ui) so the auth pages can
 * reuse them too.
 *
 * Two thresholds are deliberate: CSS switches chrome at `md` (768px), while
 * the JS media query below (1024px) only decides whether the desktop rail
 * starts expanded or collapsed.
 */
@Component({
  selector: 'app-shell',
  imports: [
    RouterLink,
    RouterOutlet,
    TranslocoDirective,
    Icon,
    Logo,
    Button,
    Sidebar,
    BottomNav,
    SectionTabs,
    ConfirmDialog,
    CommandPalette,
    LanguageSelect,
    ThemeToggle,
    UpdateBanner,
  ],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
  host: {
    '(document:keydown)': 'onGlobalKeydown($event)',
  },
})
export class Shell {
  private readonly destroyRef = inject(DestroyRef);
  protected readonly balanceVisibility = inject(BalanceVisibilityService);
  protected readonly commandPalette = inject(CommandPaletteService);
  protected readonly preferences = inject(PreferenceService);
  protected readonly session = inject(SessionService);
  protected readonly metadata = inject(MetadataService);
  protected readonly mutationErrors = inject(MutationErrorService);
  protected readonly mobileNav = inject(MobileNav);
  protected readonly profileInitials = computed(() => userInitials(this.session.user()));
  protected readonly profileName = computed(
    () => this.session.user()?.displayName || this.session.user()?.email || '',
  );

  protected readonly isMac = isMacPlatform();

  private readonly desktopSidebarMedia =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 1024px)')
      : null;
  private readonly viewportIsDesktop = signal(this.desktopSidebarMedia?.matches ?? false);
  private readonly sidebarOverride = signal<boolean | null>(null);
  protected readonly sidebarExpanded = computed(
    () => this.sidebarOverride() ?? this.viewportIsDesktop(),
  );
  protected readonly mobileNavOpen = signal(false);
  private readonly drawer = viewChild<ElementRef<HTMLDialogElement>>('drawer');

  constructor() {
    const media = this.desktopSidebarMedia;
    if (media && typeof media.addEventListener === 'function') {
      const onMediaChange = (event: MediaQueryListEvent) => {
        this.viewportIsDesktop.set(event.matches);
      };

      media.addEventListener('change', onMediaChange);
      this.destroyRef.onDestroy(() => media.removeEventListener('change', onMediaChange));
    }

    effect(() => {
      const element = this.drawer()?.nativeElement;
      if (!element) return;
      if (this.mobileNavOpen()) {
        if (!element.open) element.showModal();
      } else if (element.open) {
        element.close();
      }
    });
  }

  protected toggleBalances(): void {
    this.preferences.setBalancesHidden(!this.balanceVisibility.hidden());
  }

  protected toggleSidebar(): void {
    this.sidebarOverride.set(!this.sidebarExpanded());
  }

  protected onDrawerNativeClose(): void {
    this.mobileNavOpen.set(false);
  }

  protected onDrawerBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.mobileNavOpen.set(false);
    }
  }

  protected openCommandPalette(): void {
    this.mobileNavOpen.set(false);
    this.commandPalette.show();
  }

  protected onGlobalKeydown(event: KeyboardEvent): void {
    if (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.commandPalette.toggle();
    }
  }
}
