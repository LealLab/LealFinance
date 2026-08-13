import { DOCUMENT } from '@angular/common';
import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterOutlet } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { BalanceVisibilityService } from '../core/balance-visibility.service';
import { CommandPaletteService } from '../core/command-palette.service';
import { isMacPlatform } from '../core/platform';
import { ThemeService } from '../core/theme.service';
import { Button } from '../shared/ui/button/button';
import { ConfirmDialog } from '../shared/ui/confirm-dialog/confirm-dialog';
import { Icon } from '../shared/ui/icon/icon';
import { Logo } from '../shared/ui/logo/logo';
import { CommandPalette } from './command-palette/command-palette';
import { Sidebar } from './sidebar';

/**
 * App shell: a persistent sidebar on `md+` screens (icon rail from `md` to
 * `lg`, full labels from `lg` up — see sidebar.ts), collapsing to a
 * hamburger-triggered off-canvas drawer below `md`. Theme/balance-visibility
 * toggles, the language switcher, and the command-palette trigger all live
 * in the sidebar/drawer now (not the top `<header>`, which below `md` only
 * carries the hamburger + mobile title).
 */
@Component({
  selector: 'app-shell',
  imports: [RouterLink, RouterOutlet, TranslocoDirective, Icon, Logo, Button, Sidebar, ConfirmDialog, CommandPalette],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
  host: {
    '(document:keydown)': 'onGlobalKeydown($event)'
  }
})
export class Shell {
  private readonly document = inject(DOCUMENT);
  private readonly transloco = inject(TranslocoService);
  protected readonly theme = inject(ThemeService);
  protected readonly balanceVisibility = inject(BalanceVisibilityService);
  protected readonly commandPalette = inject(CommandPaletteService);

  protected readonly availableLangs = this.transloco.getAvailableLangs() as string[];
  protected readonly activeLang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang()
  });
  protected readonly isMac = isMacPlatform();

  protected readonly mobileNavOpen = signal(false);
  private readonly drawer = viewChild<ElementRef<HTMLDialogElement>>('drawer');

  constructor() {
    effect(() => {
      this.document.documentElement.lang = this.activeLang();
    });

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

  protected setLang(lang: string): void {
    this.transloco.setActiveLang(lang);
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
