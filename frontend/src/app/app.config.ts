import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import { routes } from './app.routes';
import { httpErrorInterceptor } from './core/http-error.interceptor';
import { provideAppTransloco } from './core/transloco.providers';
import { AccountRepository } from './data/account.repository';
import { BudgetRepository } from './data/budget.repository';
import { BudgetPlanRepository } from './data/budget-plan.repository';
import { CategoryRepository } from './data/category.repository';
import { ExchangeRateRepository } from './data/exchange-rate.repository';
import { InstitutionRepository } from './data/institution.repository';
import { GoalRepository } from './data/goal.repository';
import { MockAccountRepository } from './data/mock/mock-account.repository';
import { MockBudgetRepository } from './data/mock/mock-budget.repository';
import { MockBudgetPlanRepository } from './data/mock/mock-budget-plan.repository';
import { MockCategoryRepository } from './data/mock/mock-category.repository';
import { MockExchangeRateRepository } from './data/mock/mock-exchange-rate.repository';
import { MockGoalRepository } from './data/mock/mock-goal.repository';
import { MockInstitutionRepository } from './data/mock/mock-institution.repository';
import { MockRecurringRuleRepository } from './data/mock/mock-recurring-rule.repository';
import { MockTransactionRepository } from './data/mock/mock-transaction.repository';
import { RecurringRuleRepository } from './data/recurring-rule.repository';
import { TransactionRepository } from './data/transaction.repository';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    // withComponentInputBinding: route params (e.g. `:id`) bind straight
    // to a matching `input()` on the routed component - see
    // features/accounts/account-detail.ts for the pattern.
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([httpErrorInterceptor])),
    provideAppTransloco(),
    // Every screen is built against mock data for now (no domain backend
    // yet - see CLAUDE.md). Swapping to real HTTP later is limited to
    // this block: each abstract *Repository stays the DI token components
    // inject, only `useClass` changes.
    { provide: AccountRepository, useClass: MockAccountRepository },
    { provide: TransactionRepository, useClass: MockTransactionRepository },
    { provide: CategoryRepository, useClass: MockCategoryRepository },
    { provide: BudgetRepository, useClass: MockBudgetRepository },
    { provide: BudgetPlanRepository, useClass: MockBudgetPlanRepository },
    { provide: GoalRepository, useClass: MockGoalRepository },
    { provide: RecurringRuleRepository, useClass: MockRecurringRuleRepository },
    { provide: ExchangeRateRepository, useClass: MockExchangeRateRepository },
    { provide: InstitutionRepository, useClass: MockInstitutionRepository }
  ]
};
