import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConfirmService } from '../../core/confirm.service';
import { AccountRepository } from '../../data/account.repository';
import { CardInvoiceRepository } from '../../data/card-invoice.repository';
import { MockAccountRepository } from '../../data/mock/mock-account.repository';
import { MockCardInvoiceRepository } from '../../data/mock/mock-card-invoice.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { Account } from '../../domain/models/account';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';
import { CardInvoices } from './card-invoices';

describe('CardInvoices', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CardInvoices, provideTestTransloco()],
      providers: [
        provideZonelessChangeDetection(),
        provideTestTranslocoLocale(),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: CardInvoiceRepository, useClass: MockCardInvoiceRepository },
      ],
    }).compileComponents();
  });

  async function card(): Promise<Account> {
    return new Promise((resolve) => {
      TestBed.inject(AccountRepository)
        .list()
        .subscribe((accounts) => resolve(accounts.find((a) => a.type === 'credit_card')!));
    });
  }

  async function mount(): Promise<{ fixture: ReturnType<typeof TestBed.createComponent<CardInvoices>>; account: Account }> {
    const account = await card();
    const fixture = TestBed.createComponent(CardInvoices);
    fixture.componentRef.setInput('accountId', account.id);
    fixture.componentRef.setInput('card', account);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, account };
  }

  it('renders a current invoice and marks future cycles as projected', async () => {
    const { fixture } = await mount();
    const component = fixture.componentInstance;

    expect(component['current']()).toBeDefined();
    expect(component['upcoming']().length).toBeGreaterThan(0);
    expect(component['upcoming']().every((inv) => inv.status === 'projected')).toBe(true);
  });

  it('shows an empty state when the card has no closing/due day', async () => {
    const account = { ...(await card()), closingDay: undefined, dueDay: undefined };
    const fixture = TestBed.createComponent(CardInvoices);
    fixture.componentRef.setInput('accountId', account.id);
    fixture.componentRef.setInput('card', account);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['cycleConfigured']()).toBe(false);
    expect(fixture.nativeElement.querySelector('app-empty-state')).toBeTruthy();
  });

  it('confirms with the remaining amount, then posts a payment and emits paid', async () => {
    const { fixture, account } = await mount();
    const component = fixture.componentInstance;
    let emitted = false;
    component.paid.subscribe(() => (emitted = true));

    const invoice = {
      closeDate: '2026-01-20',
      dueDate: '2026-01-27',
      periodStart: '2025-12-21',
      periodEnd: '2026-01-20',
      currency: account.currency,
      total: '120.0000',
      paid: '0.0000',
      remaining: '120.0000',
      status: 'closed' as const,
    };

    const pending = component['pay'](invoice);
    fixture.detectChanges();
    const request = TestBed.inject(ConfirmService).request();
    expect(request?.params).toEqual({ amount: '120.0000', currency: account.currency });
    TestBed.inject(ConfirmService).respond(true);
    await pending;
    await fixture.whenStable();

    expect(emitted).toBe(true);
  });

  it('does not pay when the confirmation is dismissed', async () => {
    const { fixture, account } = await mount();
    const component = fixture.componentInstance;
    let emitted = false;
    component.paid.subscribe(() => (emitted = true));

    const pending = component['pay']({
      closeDate: '2026-01-20',
      dueDate: '2026-01-27',
      periodStart: '2025-12-21',
      periodEnd: '2026-01-20',
      currency: account.currency,
      total: '10.0000',
      paid: '0.0000',
      remaining: '10.0000',
      status: 'closed',
    });
    fixture.detectChanges();
    TestBed.inject(ConfirmService).respond(false);
    await pending;

    expect(emitted).toBe(false);
  });
});
