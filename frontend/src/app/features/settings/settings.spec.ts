import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { BehaviorSubject } from 'rxjs';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { MetadataService } from '../../core/metadata.service';
import { Settings } from './settings';
import ptBR from '../../../../public/i18n/pt-BR.json';

describe('Settings', () => {
  let fragment: BehaviorSubject<string | null>;

  beforeEach(async () => {
    fragment = new BehaviorSubject<string | null>(null);
    await TestBed.configureTestingModule({
      imports: [
        Settings,
        TranslocoTestingModule.forRoot({
          langs: { 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' }
        })
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { fragment: fragment.asObservable(), snapshot: { fragment: null } }
        }
      ]
    }).compileComponents();
    TestBed.inject(MetadataService).currencies.set([
      { code: 'BRL', name: 'Real', symbol: 'R$', decimalDigits: 2, isActive: true },
      { code: 'USD', name: 'US Dollar', symbol: '$', decimalDigits: 2, isActive: true },
    ]);
  });

  it('renders appearance, currency, and agents sections without mock controls', () => {
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Configurações');
    expect(text).toContain('Aparência');
    expect(text).toContain('Moeda de exibição');
    expect(text).not.toContain('Dados de demonstração');
    expect(text).toContain('Agentes de IA');
  });

  it('switches the theme when a theme button is clicked', () => {
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();

    const darkButton = Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
      (b as HTMLButtonElement).textContent?.includes('Escuro')
    ) as HTMLButtonElement;
    darkButton.click();
    fixture.detectChanges();

    expect(fixture.componentInstance['theme'].current()).toBe('dark');
    // Reset for any test ordering that relies on light being the default.
    fixture.componentInstance['setTheme']('light');
  });

  it('shows the persisted display currency and can change it back to BRL', () => {
    const displayCurrency = TestBed.inject(DisplayCurrencyService);
    displayCurrency.setCurrency('USD');

    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector(
      '#settings-display-currency'
    ) as HTMLSelectElement;
    expect(select.value).toBe('USD');

    select.value = 'BRL';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(displayCurrency.currency()).toBe('BRL');
    expect(select.value).toBe('BRL');
  });

  it.each([
    ['settings-language', 'settings-language'],
    ['settings-display-currency', 'settings-display-currency']
  ])('focuses the %s control when its route fragment becomes active', (routeFragment, id) => {
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();

    fragment.next(routeFragment);
    fixture.detectChanges();

    expect(document.activeElement).toBe(fixture.nativeElement.querySelector(`#${id}`));
  });
});
