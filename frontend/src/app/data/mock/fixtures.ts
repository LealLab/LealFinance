import { addMonthsClamped, formatIsoDate, monthKey } from '../../domain/calc/dates';
import { Account } from '../../domain/models/account';
import { Budget } from '../../domain/models/budget';
import { Category } from '../../domain/models/category';
import { Institution } from '../../domain/models/institution';
import { RecurringRule } from '../../domain/models/recurring';
import { Transaction } from '../../domain/models/transaction';

export interface Fixtures {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  recurringRules: RecurringRule[];
  institutions: Institution[];
}

const ACCOUNT_IDS = {
  checking: 'acc-checking',
  savings: 'acc-savings',
  cash: 'acc-cash',
  creditCard: 'acc-credit-card',
  investment: 'acc-investment'
} as const;

const INSTITUTION_IDS = {
  bancoLeal: 'inst-banco-leal',
  xpEurope: 'inst-xp-europe'
} as const;

const CATEGORY_IDS = {
  salary: 'cat-salary',
  freelance: 'cat-freelance',
  otherIncome: 'cat-other-income',
  housing: 'cat-housing',
  rent: 'cat-rent',
  condo: 'cat-condo',
  utilities: 'cat-utilities',
  food: 'cat-food',
  groceries: 'cat-groceries',
  restaurants: 'cat-restaurants',
  transport: 'cat-transport',
  fuel: 'cat-fuel',
  rideshare: 'cat-rideshare',
  health: 'cat-health',
  leisure: 'cat-leisure',
  education: 'cat-education',
  otherExpense: 'cat-other-expense'
} as const;

function buildAccounts(): Account[] {
  return [
    {
      id: ACCOUNT_IDS.checking,
      name: 'Conta Corrente',
      type: 'checking',
      currency: 'BRL',
      openingBalance: '5000',
      institutionId: INSTITUTION_IDS.bancoLeal,
      archived: false
    },
    {
      id: ACCOUNT_IDS.savings,
      name: 'Poupança',
      type: 'savings',
      currency: 'BRL',
      openingBalance: '15000',
      institutionId: INSTITUTION_IDS.bancoLeal,
      archived: false
    },
    {
      id: ACCOUNT_IDS.cash,
      name: 'Carteira',
      type: 'cash',
      currency: 'BRL',
      openingBalance: '150',
      archived: false
    },
    {
      id: ACCOUNT_IDS.creditCard,
      name: 'Cartão de Crédito',
      type: 'credit_card',
      currency: 'BRL',
      openingBalance: '0',
      institutionId: INSTITUTION_IDS.bancoLeal,
      archived: false,
      creditLimit: '8000',
      closingDay: 20,
      dueDay: 27
    },
    {
      // Deliberately a currency the mock exchange-rate repository doesn't
      // map (see data/mock/mock-exchange-rate.repository.ts) — this
      // account is what exercises the fallback-rate warning on real
      // screens instead of leaving that component dead code.
      id: ACCOUNT_IDS.investment,
      name: 'Investimentos (Europa)',
      type: 'investment',
      currency: 'EUR',
      openingBalance: '2000',
      institutionId: INSTITUTION_IDS.xpEurope,
      archived: false
    }
  ];
}

/**
 * Two institutions, matching buildAccounts' shape: Banco Leal groups 3 BRL
 * accounts (checking/savings/credit card), XP Europe groups the single EUR
 * investment account, and the cash account is left without an institution
 * on purpose — that's the "Sem instituição" bucket on the Accounts screen.
 */
function buildInstitutions(): Institution[] {
  return [
    {
      id: INSTITUTION_IDS.bancoLeal,
      name: 'Banco Leal',
      icon: 'bank',
      color: '#1F5C6B',
      archived: false,
      position: 0
    },
    {
      id: INSTITUTION_IDS.xpEurope,
      name: 'Corretora XP Europe',
      icon: 'bank',
      color: '#6D5DD3',
      archived: false,
      position: 1
    }
  ];
}

function buildCategories(): Category[] {
  const c = CATEGORY_IDS;
  return [
    { id: c.salary, name: 'Salário', kind: 'income', color: '#3E7D4C', icon: 'wallet', archived: false },
    { id: c.freelance, name: 'Freelance', kind: 'income', color: '#3E7D4C', icon: 'chart', archived: false },
    {
      id: c.otherIncome,
      name: 'Outras Receitas',
      kind: 'income',
      color: '#3E7D4C',
      icon: 'plus',
      archived: false
    },

    { id: c.housing, name: 'Moradia', kind: 'expense', color: '#6D5DD3', icon: 'home', archived: false },
    {
      id: c.rent,
      name: 'Aluguel',
      kind: 'expense',
      parentId: c.housing,
      color: '#6D5DD3',
      icon: 'home',
      archived: false
    },
    {
      id: c.condo,
      name: 'Condomínio',
      kind: 'expense',
      parentId: c.housing,
      color: '#6D5DD3',
      icon: 'home',
      archived: false
    },
    {
      id: c.utilities,
      name: 'Energia',
      kind: 'expense',
      parentId: c.housing,
      color: '#6D5DD3',
      icon: 'sun',
      archived: false
    },

    { id: c.food, name: 'Alimentação', kind: 'expense', color: '#DD8A3C', icon: 'archive', archived: false },
    {
      id: c.groceries,
      name: 'Supermercado',
      kind: 'expense',
      parentId: c.food,
      color: '#DD8A3C',
      icon: 'archive',
      archived: false
    },
    {
      id: c.restaurants,
      name: 'Restaurantes',
      kind: 'expense',
      parentId: c.food,
      color: '#DD8A3C',
      icon: 'tag',
      archived: false
    },

    { id: c.transport, name: 'Transporte', kind: 'expense', color: '#3C9DDD', icon: 'swap', archived: false },
    {
      id: c.fuel,
      name: 'Combustível',
      kind: 'expense',
      parentId: c.transport,
      color: '#3C9DDD',
      icon: 'swap',
      archived: false
    },
    {
      id: c.rideshare,
      name: 'Uber/Táxi',
      kind: 'expense',
      parentId: c.transport,
      color: '#3C9DDD',
      icon: 'swap',
      archived: false
    },

    { id: c.health, name: 'Saúde', kind: 'expense', color: '#DD5C6B', icon: 'alertTriangle', archived: false },
    { id: c.leisure, name: 'Lazer', kind: 'expense', color: '#4DAE8B', icon: 'sun', archived: false },
    { id: c.education, name: 'Educação', kind: 'expense', color: '#A16FE0', icon: 'pencil', archived: false },
    {
      id: c.otherExpense,
      name: 'Outras Despesas',
      kind: 'expense',
      color: '#8A8A82',
      icon: 'tag',
      archived: false
    }
  ];
}

/**
 * 12 trailing months of plausible BRL activity, generated relative to
 * *today* (not a fixed date) so the app always looks current whenever
 * it's opened, plus a handful of "recent extras" anchored to today so the
 * budgets screen always has something unbudgeted to show regardless of
 * what day of the month it is.
 */
function buildTransactionsAndRules(): { transactions: Transaction[]; recurringRules: RecurringRule[] } {
  const today = new Date();
  const currentMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const firstMonthStart = addMonthsClamped(currentMonthStart, -11);

  let counter = 0;
  const nextId = (): string => `tx-${++counter}`;
  const dayOf = (monthStart: Date, day: number): Date =>
    new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day));
  const onOrBeforeToday = (date: Date): boolean => date.getTime() <= today.getTime();

  const transactions: Transaction[] = [];

  for (
    let cursor = firstMonthStart, monthIndex = 0;
    cursor.getTime() <= currentMonthStart.getTime();
    cursor = addMonthsClamped(cursor, 1), monthIndex++
  ) {
    const push = (date: Date, tx: Omit<Transaction, 'id' | 'date'>): void => {
      if (!onOrBeforeToday(date)) return;
      transactions.push({ ...tx, id: nextId(), date: formatIsoDate(date) });
    };

    push(dayOf(cursor, 5), {
      type: 'income',
      amount: '7200.00',
      currency: 'BRL',
      accountId: ACCOUNT_IDS.checking,
      categoryId: CATEGORY_IDS.salary,
      description: 'Salário mensal',
      recurringRuleId: 'rule-salary'
    });

    push(dayOf(cursor, 1), {
      type: 'expense',
      amount: '1850.00',
      currency: 'BRL',
      accountId: ACCOUNT_IDS.checking,
      categoryId: CATEGORY_IDS.rent,
      description: 'Aluguel',
      recurringRuleId: 'rule-rent'
    });

    push(dayOf(cursor, 5), {
      type: 'expense',
      amount: '420.00',
      currency: 'BRL',
      accountId: ACCOUNT_IDS.checking,
      categoryId: CATEGORY_IDS.condo,
      description: 'Condomínio'
    });

    push(dayOf(cursor, 12), {
      type: 'expense',
      amount: (180 + (monthIndex % 4) * 15).toFixed(2),
      currency: 'BRL',
      accountId: ACCOUNT_IDS.checking,
      categoryId: CATEGORY_IDS.utilities,
      description: 'Conta de energia'
    });

    for (const day of [3, 10, 17, 24]) {
      push(dayOf(cursor, day), {
        type: 'expense',
        amount: (220 + ((monthIndex + day) % 5) * 12).toFixed(2),
        currency: 'BRL',
        accountId: ACCOUNT_IDS.checking,
        categoryId: CATEGORY_IDS.groceries,
        description: 'Supermercado'
      });
    }

    for (const day of [7, 21]) {
      push(dayOf(cursor, day), {
        type: 'expense',
        amount: (60 + ((monthIndex + day) % 6) * 8).toFixed(2),
        currency: 'BRL',
        accountId: ACCOUNT_IDS.creditCard,
        categoryId: CATEGORY_IDS.restaurants,
        description: 'Restaurante'
      });
    }

    for (const day of [6, 20]) {
      push(dayOf(cursor, day), {
        type: 'expense',
        amount: (150 + ((monthIndex + day) % 4) * 10).toFixed(2),
        currency: 'BRL',
        accountId: ACCOUNT_IDS.checking,
        categoryId: CATEGORY_IDS.fuel,
        description: 'Combustível'
      });
    }

    for (const day of [9, 16, 27]) {
      push(dayOf(cursor, day), {
        type: 'expense',
        amount: (18 + ((monthIndex + day) % 5) * 4).toFixed(2),
        currency: 'BRL',
        accountId: ACCOUNT_IDS.creditCard,
        categoryId: CATEGORY_IDS.rideshare,
        description: 'Uber'
      });
    }

    push(dayOf(cursor, 8), {
      type: 'expense',
      amount: '39.90',
      currency: 'BRL',
      accountId: ACCOUNT_IDS.creditCard,
      categoryId: CATEGORY_IDS.leisure,
      description: 'Assinatura de streaming',
      recurringRuleId: 'rule-streaming'
    });

    push(dayOf(cursor, 6), {
      type: 'transfer',
      amount: '800.00',
      currency: 'BRL',
      accountId: ACCOUNT_IDS.checking,
      toAccountId: ACCOUNT_IDS.savings,
      description: 'Transferência para poupança'
    });
  }

  const guaranteedFloor: {
    accountId: string;
    categoryId: string;
    amount: string;
    description: string;
  }[] = [
    {
      accountId: ACCOUNT_IDS.checking,
      categoryId: CATEGORY_IDS.health,
      amount: '260.00',
      description: 'Consulta médica'
    },
    {
      accountId: ACCOUNT_IDS.creditCard,
      categoryId: CATEGORY_IDS.education,
      amount: '189.00',
      description: 'Curso online'
    },
    {
      accountId: ACCOUNT_IDS.creditCard,
      categoryId: CATEGORY_IDS.leisure,
      amount: '95.00',
      description: 'Cinema'
    },
    // Two extra grocery runs, on top of the day-of-month pattern above,
    // so Alimentação's spend reliably clears its budget (see buildBudgets)
    // even on the 1st or 2nd of the month, before that pattern has posted
    // anything of its own yet.
    {
      accountId: ACCOUNT_IDS.checking,
      categoryId: CATEGORY_IDS.groceries,
      amount: '310.00',
      description: 'Supermercado'
    },
    {
      accountId: ACCOUNT_IDS.checking,
      categoryId: CATEGORY_IDS.groceries,
      amount: '295.00',
      description: 'Supermercado'
    },
    // Same idea for Transporte, to reliably land in the "near budget" band.
    {
      accountId: ACCOUNT_IDS.creditCard,
      categoryId: CATEGORY_IDS.fuel,
      amount: '380.00',
      description: 'Combustível'
    }
  ];
  // Dated on the 1st of the current month — not `push`/`onOrBeforeToday`,
  // and deliberately not "today minus a few days" either: an offset from
  // today can land in the *previous* month whenever today is early in the
  // month, which would silently drop these out of the current month's
  // budget/category totals. The 1st is the one date guaranteed to be
  // both in the current month and on-or-before today, always. Also kept
  // out of the housing budget above so Saúde and Educação always show up
  // as *unbudgeted* spend on the budgets screen.
  for (const extra of guaranteedFloor) {
    transactions.push({
      id: nextId(),
      type: 'expense',
      date: formatIsoDate(dayOf(currentMonthStart, 1)),
      amount: extra.amount,
      currency: 'BRL',
      accountId: extra.accountId,
      categoryId: extra.categoryId,
      description: extra.description
    });
  }

  const recurringRules: RecurringRule[] = [
    {
      id: 'rule-salary',
      frequency: 'monthly',
      interval: 1,
      startDate: formatIsoDate(dayOf(firstMonthStart, 5)),
      template: {
        type: 'income',
        amount: '7200.00',
        currency: 'BRL',
        accountId: ACCOUNT_IDS.checking,
        categoryId: CATEGORY_IDS.salary,
        description: 'Salário mensal'
      }
    },
    {
      id: 'rule-rent',
      frequency: 'monthly',
      interval: 1,
      startDate: formatIsoDate(dayOf(firstMonthStart, 1)),
      template: {
        type: 'expense',
        amount: '1850.00',
        currency: 'BRL',
        accountId: ACCOUNT_IDS.checking,
        categoryId: CATEGORY_IDS.rent,
        description: 'Aluguel'
      }
    },
    {
      id: 'rule-streaming',
      frequency: 'monthly',
      interval: 1,
      startDate: formatIsoDate(dayOf(firstMonthStart, 8)),
      template: {
        type: 'expense',
        amount: '39.90',
        currency: 'BRL',
        accountId: ACCOUNT_IDS.creditCard,
        categoryId: CATEGORY_IDS.leisure,
        description: 'Assinatura de streaming'
      }
    }
  ];

  return { transactions, recurringRules };
}

/**
 * Budgets for the current month only — the budgets screen's month
 * selector has nothing to show for other months by design, the same way
 * a real user wouldn't have planned a budget for a month they haven't
 * reached yet.
 *
 * Sized against buildTransactionsAndRules' generation formulas to land in
 * under/over/near states respectively, and — this is the part that took a
 * bug to get right — sized so that holds on *any* day of the month, not
 * just by the time the day-of-month pattern above has fully played out.
 * `guaranteedFloor` there posts a fixed amount on the 1st regardless of
 * what today is; food/transport's budgets are set low enough that that
 * floor alone already produces the intended state, and whatever the
 * day-of-month pattern adds on top only pushes further the same
 * direction. Saúde and Educação are left unbudgeted on purpose (see
 * `guaranteedFloor` above).
 */
function buildBudgets(currentMonthKey: string): Budget[] {
  const c = CATEGORY_IDS;
  return [
    { id: 'budget-housing', categoryId: c.housing, month: currentMonthKey, amount: '3200.00', currency: 'BRL' },
    { id: 'budget-food', categoryId: c.food, month: currentMonthKey, amount: '500.00', currency: 'BRL' },
    {
      id: 'budget-transport',
      categoryId: c.transport,
      month: currentMonthKey,
      amount: '450.00',
      currency: 'BRL'
    },
    { id: 'budget-leisure', categoryId: c.leisure, month: currentMonthKey, amount: '200.00', currency: 'BRL' }
  ];
}

export function createFixtures(): Fixtures {
  const today = new Date();
  const currentMonthKey = monthKey(
    formatIsoDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)))
  );
  const { transactions, recurringRules } = buildTransactionsAndRules();

  return {
    accounts: buildAccounts(),
    categories: buildCategories(),
    transactions,
    recurringRules,
    budgets: buildBudgets(currentMonthKey),
    institutions: buildInstitutions()
  };
}
