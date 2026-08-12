import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterOutlet } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';

/**
 * App shell: nav + language switcher. The switcher exists even with a
 * single language (pt-BR) — see docs/i18n.md for why: it forces the
 * runtime-language-change plumbing to be real from day one, rather than
 * something bolted on when a second language actually arrives.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterLink, RouterOutlet, TranslocoDirective],
  templateUrl: './shell.html',
  styleUrl: './shell.scss'
})
export class Shell {
  private readonly transloco = inject(TranslocoService);

  protected readonly availableLangs = this.transloco.getAvailableLangs() as string[];
  protected readonly activeLang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang()
  });

  protected setLang(lang: string): void {
    this.transloco.setActiveLang(lang);
  }
}
