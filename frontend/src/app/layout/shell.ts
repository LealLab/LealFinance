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
import { isMacPlatform } from '../core/platform';
import { PreferenceService } from '../core/preference.service';
import { SessionService } from '../core/session.service';
import { MutationErrorService } from '../core/mutation-error.service';
import { Button } from '../shared/ui/button/button';
import { ConfirmDialog } from '../shared/ui/confirm-dialog/confirm-dialog';
import { Icon } from '../shared/ui/icon/icon';
import { LanguageSelect } from '../shared/ui/language-select/language-select';
import { Logo } from '../shared/ui/logo/logo';
import { ThemeToggle } from '../shared/ui/theme-toggle/theme-toggle';
import { CommandPalette } from './command-palette/command-palette';
import { Sidebar } from './sidebar';
import { UpdateBanner } from './update-banner/update-banner';

/**
 * App shell: a persistent sidebar on `md+` screens (icon rail from `md` to
 * `lg`, full labels from `lg` up - see sidebar.ts), collapsing to a
 * hamburger-triggered off-canvas drawer below `md`. Balance-visibility
 * toggle, the theme toggle, the language switcher, and the command-palette
 * trigger all live in the sidebar/drawer now (not the top `<header>`, which
 * below `md` only carries the hamburger + mobile title). Theme/language
 * controls are `app-theme-toggle`/`app-language-select` (shared/ui) so the
 * auth pages can reuse them too.
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
  protected readonly mutationErrors = inject(MutationErrorService);

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
