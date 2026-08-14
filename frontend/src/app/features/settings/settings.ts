import { Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { MetadataService } from '../../core/metadata.service';
import { PreferenceService } from '../../core/preference.service';
import { Theme, ThemeService } from '../../core/theme.service';
import { Card } from '../../shared/ui/card/card';
import { Icon } from '../../shared/ui/icon/icon';
import { PageHeader } from '../../shared/ui/page-header/page-header';

@Component({
  selector: 'app-settings',
  imports: [TranslocoDirective, Card, Icon, PageHeader],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings {
  protected readonly theme = inject(ThemeService);
  protected readonly displayCurrencyService = inject(DisplayCurrencyService);
  private readonly transloco = inject(TranslocoService);
  private readonly route = inject(ActivatedRoute);
  protected readonly preferences = inject(PreferenceService);
  protected readonly metadata = inject(MetadataService);

  protected readonly currencyOptions = this.metadata.currencies;
  protected readonly availableLangs = this.transloco.getAvailableLangs() as string[];
  protected readonly activeLang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang(),
  });
  private readonly fragment = toSignal(this.route.fragment, {
    initialValue: this.route.snapshot.fragment,
  });
  private readonly languageSelect = viewChild<ElementRef<HTMLSelectElement>>('languageSelect');
  private readonly displayCurrencySelect =
    viewChild<ElementRef<HTMLSelectElement>>('displayCurrencySelect');

  constructor() {
    effect(() => {
      const target =
        this.fragment() === 'settings-language'
          ? this.languageSelect()?.nativeElement
          : this.fragment() === 'settings-display-currency'
            ? this.displayCurrencySelect()?.nativeElement
            : undefined;

      if (!target) return;
      target.scrollIntoView?.({ block: 'center' });
      target.focus();
    });
  }

  protected setLang(lang: string): void {
    this.preferences.setLocale(lang);
  }

  protected setTheme(theme: Theme): void {
    this.preferences.setTheme(theme);
  }

  protected setDisplayCurrency(currency: string): void {
    this.preferences.setDisplayCurrency(currency);
  }
}
