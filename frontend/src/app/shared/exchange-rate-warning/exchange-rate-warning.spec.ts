import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { ExchangeRateWarning } from './exchange-rate-warning';
import ptBR from '../../../../public/i18n/pt-BR.json';

describe('ExchangeRateWarning', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        ExchangeRateWarning,
        TranslocoTestingModule.forRoot({
          langs: { 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' }
        })
      ],
      providers: [provideZonelessChangeDetection()]
    }).compileComponents();
  });

  it('renders nothing when the rate is not a fallback', () => {
    const fixture = TestBed.createComponent(ExchangeRateWarning);
    fixture.componentRef.setInput('isFallback', false);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows the translated warning when the rate is a fallback', () => {
    const fixture = TestBed.createComponent(ExchangeRateWarning);
    fixture.componentRef.setInput('isFallback', true);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const alert = compiled.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Taxa de câmbio indisponível');
  });
});
