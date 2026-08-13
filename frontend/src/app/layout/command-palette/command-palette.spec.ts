import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { ThemeService } from '../../core/theme.service';
import { CommandPaletteService } from '../../core/command-palette.service';
import { AccountRepository } from '../../data/account.repository';
import { BudgetRepository } from '../../data/budget.repository';
import { CategoryRepository } from '../../data/category.repository';
import { MockAccountRepository } from '../../data/mock/mock-account.repository';
import { MockBudgetRepository } from '../../data/mock/mock-budget.repository';
import { MockCategoryRepository } from '../../data/mock/mock-category.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { MockTransactionRepository } from '../../data/mock/mock-transaction.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { CommandPalette } from './command-palette';
import ptBR from '../../../../public/i18n/pt-BR.json';

describe('CommandPalette', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        CommandPalette,
        TranslocoTestingModule.forRoot({
          langs: { 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' }
        })
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: CategoryRepository, useClass: MockCategoryRepository },
        { provide: BudgetRepository, useClass: MockBudgetRepository },
        { provide: TransactionRepository, useClass: MockTransactionRepository }
      ]
    }).compileComponents();
  });

  it('stays closed until CommandPaletteService.show() is called', () => {
    const fixture = TestBed.createComponent(CommandPalette);
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(false);

    TestBed.inject(CommandPaletteService).show();
    fixture.detectChanges();

    expect(dialog.open).toBe(true);
  });

  it('closes and flips the service state back when the dialog closes itself (e.g. Escape)', () => {
    const fixture = TestBed.createComponent(CommandPalette);
    const service = TestBed.inject(CommandPaletteService);
    service.show();
    fixture.detectChanges();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;

    dialog.close();
    fixture.detectChanges();

    expect(service.isOpen()).toBe(false);
  });

  it('filters the "Go to" items as the query changes, diacritic- and case-insensitively', () => {
    const fixture = TestBed.createComponent(CommandPalette);
    TestBed.inject(CommandPaletteService).show();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'ORCAMENTOS';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const labels = buttons.map((b) => b.textContent?.trim());

    expect(labels.some((label) => label?.includes('Orçamentos'))).toBe(true);
    expect(labels.some((label) => label?.includes('Contas'))).toBe(false);
  });

  it('shows an empty state when nothing matches the query', () => {
    const fixture = TestBed.createComponent(CommandPalette);
    TestBed.inject(CommandPaletteService).show();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'zzzzzzznomatch';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect((fixture.nativeElement.textContent as string)).toContain('Nenhum resultado encontrado');
  });

  it('ArrowDown/Enter runs the highlighted item and closes the palette', () => {
    const fixture = TestBed.createComponent(CommandPalette);
    const paletteService = TestBed.inject(CommandPaletteService);
    const theme = TestBed.inject(ThemeService);
    const initialTheme = theme.current();
    paletteService.show();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    // Narrow the list down to just the "toggle theme" quick action so
    // Enter on the first (only) highlighted result is unambiguous.
    input.value = 'Alternar tema';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();

    expect(theme.current()).not.toBe(initialTheme);
    expect(paletteService.isOpen()).toBe(false);
  });
});
