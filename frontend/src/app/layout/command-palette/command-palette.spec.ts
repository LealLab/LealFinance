import { signal, WritableSignal } from '@angular/core';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { CommandPaletteService } from '../../core/command-palette.service';
import { User } from '../../core/identity.models';
import { MetadataService } from '../../core/metadata.service';
import { SessionService } from '../../core/session.service';
import { ThemeService } from '../../core/theme.service';
import { AccountRepository } from '../../data/account.repository';
import { BudgetRepository } from '../../data/budget.repository';
import { CategoryGroupRepository } from '../../data/category-group.repository';
import { CategoryRepository } from '../../data/category.repository';
import { MockAccountRepository } from '../../data/mock/mock-account.repository';
import { MockBudgetRepository } from '../../data/mock/mock-budget.repository';
import { MockCategoryRepository } from '../../data/mock/mock-category.repository';
import { MockCategoryGroupRepository } from '../../data/mock/mock-category-group.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { MockTransactionRepository } from '../../data/mock/mock-transaction.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { CommandPalette } from './command-palette';
import ptBR from '../../../../public/i18n/pt-BR.json';

describe('CommandPalette', () => {
  let sessionUser: WritableSignal<User | undefined>;
  let settings: WritableSignal<{ agentsEnabled: boolean } | undefined>;

  beforeEach(async () => {
    sessionUser = signal<User | undefined>(undefined);
    settings = signal<{ agentsEnabled: boolean } | undefined>(undefined);
    await TestBed.configureTestingModule({
      imports: [
        CommandPalette,
        TranslocoTestingModule.forRoot({
          langs: { 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' },
        }),
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: CategoryRepository, useClass: MockCategoryRepository },
        { provide: CategoryGroupRepository, useClass: MockCategoryGroupRepository },
        { provide: BudgetRepository, useClass: MockBudgetRepository },
        { provide: TransactionRepository, useClass: MockTransactionRepository },
        { provide: MetadataService, useValue: { settings } },
        { provide: SessionService, useValue: { user: sessionUser.asReadonly() } },
      ],
    }).compileComponents();
  });

  it('finds AI providers for an enabled admin', () => {
    sessionUser.set({
      id: 'admin-id',
      email: 'admin@example.com',
      displayName: 'Admin',
      role: 'admin',
      isActive: true,
      createdAt: '',
    });
    settings.set({ agentsEnabled: true });

    const fixture = TestBed.createComponent(CommandPalette);
    TestBed.inject(CommandPaletteService).show();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'provedores';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const labels = Array.from(fixture.nativeElement.querySelectorAll('button')).map((button) =>
      (button as HTMLButtonElement).textContent?.trim(),
    );
    expect(labels.some((label) => label?.includes('Provedores de IA'))).toBe(true);
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

    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ) as HTMLButtonElement[];
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

    expect(fixture.nativeElement.textContent as string).toContain('Nenhum resultado encontrado');
  });

  it.each([
    ['idioma', 'Configurar idioma', 'settings-language'],
    ['moeda', 'Configurar moeda de exibição', 'settings-display-currency'],
    ['dois fatores', 'Configurar autenticação de dois fatores', 'settings-two-factor'],
    // Synonyms people actually type reach the same entry, via keywordsKey.
    ['2FA', 'Configurar autenticação de dois fatores', 'settings-two-factor'],
    ['autenticador', 'Configurar autenticação de dois fatores', 'settings-two-factor'],
    ['recuperação', 'Configurar autenticação de dois fatores', 'settings-two-factor'],
  ])('finds the %s setting and navigates to its control', (query, label, fragment) => {
    const fixture = TestBed.createComponent(CommandPalette);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    TestBed.inject(CommandPaletteService).show();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = query;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const result = Array.from(fixture.nativeElement.querySelectorAll('button')).find((button) =>
      (button as HTMLButtonElement).textContent?.includes(label),
    ) as HTMLButtonElement;
    expect(result).toBeTruthy();

    result.click();
    expect(navigate).toHaveBeenCalledWith(['/settings'], { fragment });
  });

  it('matches on search keywords without rendering them in the row', () => {
    // Regression: these synonyms were once a sublabelKey. The sublabel slot
    // is shrink-0, so the long keyword list took the whole row and squeezed
    // the flex-1 label to zero width - the entry rendered with no title.
    // Asserting on textContent alone cannot catch that (CSS truncation
    // leaves the text in the DOM), so assert the keywords never render.
    const fixture = TestBed.createComponent(CommandPalette);
    TestBed.inject(CommandPaletteService).show();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = '2FA';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const row = Array.from(fixture.nativeElement.querySelectorAll('button')).find((button) =>
      (button as HTMLButtonElement).textContent?.includes(
        'Configurar autenticação de dois fatores',
      ),
    ) as HTMLButtonElement;
    expect(row).toBeTruthy();
    expect(row.textContent).not.toContain('aplicativo autenticador');
    expect(row.querySelector('.font-mono')).toBeNull();
  });

  it('finds the "Import transactions" quick action and navigates to the import route', () => {
    const fixture = TestBed.createComponent(CommandPalette);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    TestBed.inject(CommandPaletteService).show();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'importar';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const result = Array.from(fixture.nativeElement.querySelectorAll('button')).find((button) =>
      (button as HTMLButtonElement).textContent?.includes('Importar transações'),
    ) as HTMLButtonElement;
    expect(result).toBeTruthy();

    result.click();
    expect(navigate).toHaveBeenCalledWith(['/transactions/import']);
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
