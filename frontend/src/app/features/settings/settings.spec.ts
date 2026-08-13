import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { Settings } from './settings';
import ptBR from '../../../../public/i18n/pt-BR.json';

describe('Settings', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        Settings,
        TranslocoTestingModule.forRoot({
          langs: { 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' }
        })
      ],
      providers: [provideZonelessChangeDetection(), provideRouter([])]
    }).compileComponents();
  });

  it('renders appearance, currency, mock-data, and agents sections without error', () => {
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Configurações');
    expect(text).toContain('Aparência');
    expect(text).toContain('Moeda de exibição');
    expect(text).toContain('Dados de demonstração');
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
});
