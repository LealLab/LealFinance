import { booleanAttribute, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { PreferenceService } from '../../../core/preference.service';
import { Icon } from '../icon/icon';

/**
 * Language picker, used both in the app shell (sidebar rail + mobile drawer)
 * and on the auth pages. Writes through `PreferenceService`, which also
 * works while logged out - see preference.service.ts.
 *
 * `compact`: renders as an 8x8 badge showing the 2-letter language code with
 * an invisible `<select>` overlaid, instead of a full-width dropdown - used
 * for the collapsed sidebar rail and the auth pages.
 * `showIcon`: prefixes a globe icon - used for the expanded sidebar rail.
 */
@Component({
  selector: 'app-language-select',
  imports: [TranslocoDirective, Icon],
  templateUrl: './language-select.html',
  styleUrl: './language-select.scss',
})
export class LanguageSelect {
  private readonly transloco = inject(TranslocoService);
  private readonly preferences = inject(PreferenceService);

  readonly compact = input(false, { transform: booleanAttribute });
  readonly showIcon = input(false, { transform: booleanAttribute });

  protected readonly availableLangs = this.transloco.getAvailableLangs() as string[];
  protected readonly activeLang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang(),
  });
  protected readonly activeLangCode = computed(() => this.activeLang().slice(0, 2).toUpperCase());

  protected setLang(lang: string): void {
    this.preferences.setLocale(lang);
  }
}
