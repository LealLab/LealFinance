import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Account } from '../../domain/models/account';
import { Category } from '../../domain/models/category';
import { Institution } from '../../domain/models/institution';
import { money } from '../../shared/money/money';
import { buildMonthGrid, CalendarDay } from './calendar-month';
import { TransactionCalendar } from './transaction-calendar';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';

const passthrough = (amount: ReturnType<typeof money>, target: string) => money(amount.amount, target);

@Component({
  selector: 'app-calendar-host',
  imports: [TransactionCalendar],
  template: `
    <app-transaction-calendar
      [days]="days()"
      [selectedDay]="selectedDay()"
      displayCurrency="BRL"
      [converter]="converter"
      [accountsById]="accountsById"
      [institutionsById]="institutionsById"
      [categoriesById]="categoriesById"
      (daySelected)="picked = $event"
    />
  `,
})
class CalendarHost {
  converter = passthrough;
  readonly days = signal<CalendarDay[]>(
    buildMonthGrid(
      '2026-03',
      [
        {
          id: 't1',
          type: 'expense',
          date: '2026-03-10',
          amount: '40.00',
          currency: 'BRL',
          accountId: 'acc-1',
          categoryId: 'cat-1',
          description: 'Padaria',
        },
      ],
      [],
      money('1000', 'BRL'),
      passthrough,
      1,
      '2026-03-15',
    ),
  );
  readonly selectedDay = signal<string | null>(null);
  readonly accountsById = new Map<string, Account>([
    ['acc-1', { id: 'acc-1', name: 'Checking', type: 'checking', currency: 'BRL', openingBalance: '0', archived: false, institutionId: 'inst-1' }],
  ]);
  readonly institutionsById = new Map<string, Institution>([
    ['inst-1', { id: 'inst-1', name: 'Nubank', icon: 'bank', archived: false, position: 0 }],
  ]);
  readonly categoriesById = new Map<string, Category>([
    ['cat-1', { id: 'cat-1', name: 'Comida', kind: 'expense', groupId: 'g', color: '#000', icon: 'cart', position: 0 }],
  ]);
  picked?: string;
}

describe('TransactionCalendar', () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [
        CalendarHost,
        provideTestTransloco(),
      ],
      providers: [
        provideTestTranslocoLocale(),
        provideZonelessChangeDetection(),
      ],
    });
    const fixture = TestBed.createComponent(CalendarHost);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('renders 42 day cells and 7 weekday headers', () => {
    const { el } = setup();
    expect(el.querySelectorAll('.grid-cols-7 > button').length).toBe(42);
  });

  it('emits the clicked day', () => {
    const { fixture, el } = setup();
    const cells = [...el.querySelectorAll('.grid-cols-7 > button')] as HTMLButtonElement[];
    cells[10].click();
    expect(fixture.componentInstance.picked).toBeTruthy();
  });

  it('fills the selected-day panel with that day\'s transactions', () => {
    const { fixture, el } = setup();
    fixture.componentInstance.selectedDay.set('2026-03-10');
    fixture.detectChanges();
    expect(el.textContent).toContain('Padaria');
    expect(el.textContent).toContain('Checking');
    expect(el.textContent).toContain('Nubank');
  });

  it('draws a sparkline polyline once there are running balances', () => {
    const { el } = setup();
    expect(el.querySelector('svg polyline')?.getAttribute('points')).toBeTruthy();
  });

  it('nets a foreign-currency day through the converter, matching the grid delta', () => {
    const usdToBrl = (amount: ReturnType<typeof money>, target: string) =>
      target === 'BRL' && amount.currency === 'USD'
        ? money((Number(amount.amount) * 5.2).toFixed(2), 'BRL')
        : money(amount.amount, target);

    const { fixture } = setup();
    fixture.componentInstance.converter = usdToBrl;
    fixture.componentInstance.days.set(
      buildMonthGrid(
        '2026-03',
        [
          {
            id: 'u1',
            type: 'expense',
            date: '2026-03-10',
            amount: '100.00',
            currency: 'USD',
            accountId: 'acc-1',
            categoryId: 'cat-1',
            description: 'Hosting',
          },
        ],
        [],
        money('1000', 'BRL'),
        usdToBrl,
        1,
        '2026-03-15',
      ),
    );
    fixture.componentInstance.selectedDay.set('2026-03-10');
    fixture.detectChanges();

    // -520 (100 USD expense * 5.2), converted - not a raw -100.
    const calendar = fixture.debugElement.query(By.directive(TransactionCalendar))
      .componentInstance as { dayNet: () => number | null };
    expect(calendar.dayNet()).toBeCloseTo(-520, 2);
  });
});
