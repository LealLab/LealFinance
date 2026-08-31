import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { provideTestTransloco } from '../../../testing/transloco';
import { ExchangeRateWarning } from './exchange-rate-warning';

describe('ExchangeRateWarning', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        ExchangeRateWarning,
        provideTestTransloco()
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
    // Assert the component rendered the right KEY, resolved through Transloco,
    // rather than pinning the copy - rewording the catalog must not fail this.
    expect(alert?.textContent).toContain(
      TestBed.inject(TranslocoService).translate('currency.fallbackRateWarning')
    );
  });

  it('renders no action button when actionLabelKey is not set', () => {
    const fixture = TestBed.createComponent(ExchangeRateWarning);
    fixture.componentRef.setInput('isFallback', true);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('button')).toBeNull();
  });

  it('renders a translated action button and emits action() when clicked', () => {
    const fixture = TestBed.createComponent(ExchangeRateWarning);
    fixture.componentRef.setInput('isFallback', true);
    fixture.componentRef.setInput('actionLabelKey', 'currency.fallbackRateWarningAction');
    let emitted = 0;
    fixture.componentInstance.action.subscribe(() => emitted++);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const button = compiled.querySelector('button');
    // The caller-supplied actionLabelKey is looked up dynamically, so this
    // proves the dynamic t(labelKey) lookup resolves the key it was given.
    expect(button?.textContent).toContain(
      TestBed.inject(TranslocoService).translate('currency.fallbackRateWarningAction')
    );

    button?.click();
    expect(emitted).toBe(1);
  });
});
