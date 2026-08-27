import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import { Account } from '../../domain/models/account';
import { Category } from '../../domain/models/category';
import { money } from '../../shared/money/money';
import { buildMonthGrid, CalendarDay } from './calendar-month';
import { TransactionCalendar } from './transaction-calendar';
import ptBR from '../../../../public/i18n/pt-BR.json';

const passthrough = (amount: ReturnType<typeof money>, target: string) => money(amount.amount, target);

@Component({
  selector: 'app-calendar-host',
  imports: [TransactionCalendar],
  template: `
    <app-transaction-calendar
      [days]="days()"
      [selectedDay]="selectedDay()"
      displayCurrency="BRL"
      [accountsById]="accountsById"
      [categoriesById]="categoriesById"
      (daySelected)="picked = $event"
    />
  `,
})
class CalendarHost {
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
    ['acc-1', { id: 'acc-1', name: 'Checking', type: 'checking', currency: 'BRL', openingBalance: '0', archived: false }],
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
        TranslocoTestingModule.forRoot({
          langs: { 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' },
        }),
      ],
      providers: [
        provideTranslocoLocale({ defaultLocale: 'pt-BR', defaultCurrency: 'BRL' }),
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
  });

  it('draws a sparkline polyline once there are running balances', () => {
    const { el } = setup();
    expect(el.querySelector('svg polyline')?.getAttribute('points')).toBeTruthy();
  });
});
