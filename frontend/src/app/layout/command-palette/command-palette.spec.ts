import { signal, WritableSignal } from '@angular/core';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
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
import { provideTestTransloco } from '../../../testing/transloco';
import { CommandPalette } from './command-palette';

describe('CommandPalette', () => {
  let sessionUser: WritableSignal<User | undefined>;
  let settings: WritableSignal<{ agentsEnabled: boolean } | undefined>;

  beforeEach(async () => {
    sessionUser = signal<User | undefined>(undefined);
    settings = signal<{ agentsEnabled: boolean } | undefined>(undefined);
    await TestBed.configureTestingModule({
      imports: [
        CommandPalette,
        provideTestTransloco(),
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
      aiChatEnabled: false,
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

    expect(
      fixture.componentInstance['flatItems']().some((item) => item.id === 'goto-/admin/providers'),
    ).toBe(true);
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

    const itemIds = fixture.componentInstance['flatItems']().map((item) => item.id);
    expect(itemIds).toContain('goto-/budgets');
    expect(itemIds).not.toContain('goto-/accounts');
  });

  it('shows an empty state when nothing matches the query', () => {
    const fixture = TestBed.createComponent(CommandPalette);
    TestBed.inject(CommandPaletteService).show();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'zzzzzzznomatch';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.componentInstance['groups']()).toHaveLength(0);
  });

  it.each([
    ['idioma', 'quick-configure-language', 'settings-language'],
    ['moeda', 'quick-configure-currency', 'settings-display-currency'],
    ['exportar backup', 'quick-export-backup', 'settings-backup-export'],
    ['restaurar backup', 'quick-restore-backup', 'settings-backup-restore'],
    ['dois fatores', 'quick-configure-two-factor', 'settings-two-factor'],
    // Synonyms people actually type reach the same entry, via keywordsKey.
    ['2FA', 'quick-configure-two-factor', 'settings-two-factor'],
    ['autenticador', 'quick-configure-two-factor', 'settings-two-factor'],
    ['recuperação', 'quick-configure-two-factor', 'settings-two-factor'],
  ])('finds the %s setting and navigates to its control', (query, id, fragment) => {
    const fixture = TestBed.createComponent(CommandPalette);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    TestBed.inject(CommandPaletteService).show();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = query;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const result = fixture.componentInstance['flatItems']().find(
      (item) => item.id === id,
    );
    expect(result).toBeDefined();

    fixture.componentInstance['selectItem'](result!);
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

    const result = fixture.componentInstance['flatItems']().find(
      (item) => item.id === 'quick-import-transactions',
    );
    expect(result).toBeDefined();

    fixture.componentInstance['selectItem'](result!);
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
    const themeItem = fixture.componentInstance['flatItems']().find(
      (item) => item.id === 'quick-toggle-theme',
    );
    fixture.componentInstance['highlightItem'](themeItem!);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();

    expect(theme.current()).not.toBe(initialTheme);
    expect(paletteService.isOpen()).toBe(false);
  });
});
