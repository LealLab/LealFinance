import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterOutlet } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { ThemeService } from '../core/theme.service';
import { Button } from '../shared/ui/button/button';
import { ConfirmDialog } from '../shared/ui/confirm-dialog/confirm-dialog';
import { Icon } from '../shared/ui/icon/icon';
import { Sidebar } from './sidebar';

/**
 * App shell: a persistent sidebar on `md+` screens (icon rail from `md` to
 * `lg`, full labels from `lg` up — see sidebar.ts), collapsing to a
 * hamburger-triggered off-canvas drawer below `md`. Top bar carries the
 * page chrome that doesn't belong to a section: theme toggle and language
 * switcher (see docs/i18n.md for why the switcher exists with one language).
 */
@Component({
  selector: 'app-shell',
  imports: [RouterLink, RouterOutlet, TranslocoDirective, Icon, Button, Sidebar, ConfirmDialog],
  templateUrl: './shell.html',
  styleUrl: './shell.scss'
})
export class Shell {
  private readonly transloco = inject(TranslocoService);
  protected readonly theme = inject(ThemeService);

  protected readonly availableLangs = this.transloco.getAvailableLangs() as string[];
  protected readonly activeLang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang()
  });

  protected readonly mobileNavOpen = signal(false);
  private readonly drawer = viewChild<ElementRef<HTMLDialogElement>>('drawer');

  constructor() {
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
}
