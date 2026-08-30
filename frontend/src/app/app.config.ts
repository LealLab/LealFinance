import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import { routes } from './app.routes';
import { httpErrorInterceptor } from './core/http-error.interceptor';
import { provideAppTransloco } from './core/transloco.providers';
import { AccountRepository } from './data/account.repository';
import { AgentProviderRepository } from './data/agent-provider.repository';
import { BudgetRepository } from './data/budget.repository';
import { BudgetPlanRepository } from './data/budget-plan.repository';
import { CategoryGroupRepository } from './data/category-group.repository';
import { CategoryRepository } from './data/category.repository';
import { CategorizationRuleRepository } from './data/categorization-rule.repository';
import { ExchangeRateRepository } from './data/exchange-rate.repository';
import { InstitutionRepository } from './data/institution.repository';
import { GoalRepository } from './data/goal.repository';
import { LoanRepository } from './data/loan.repository';
import { InvestmentAssetRepository } from './data/investment-asset.repository';
import { InvestmentTransactionRepository } from './data/investment-transaction.repository';
import { InvestmentWalletRepository } from './data/investment-wallet.repository';
import { ManualRateRepository } from './data/manual-rate.repository';
import { MarketDataCredentialRepository } from './data/market-data-credential.repository';
import { HttpAccountRepository } from './data/http/http-account.repository';
import { HttpAgentProviderRepository } from './data/http/http-agent-provider.repository';
import { HttpBudgetPlanRepository } from './data/http/http-budget-plan.repository';
import { HttpBudgetRepository } from './data/http/http-budget.repository';
import { HttpCategoryGroupRepository } from './data/http/http-category-group.repository';
import { HttpCategoryRepository } from './data/http/http-category.repository';
import { HttpCategorizationRuleRepository } from './data/http/http-categorization-rule.repository';
import { HttpExchangeRateRepository } from './data/http/http-exchange-rate.repository';
import { HttpGoalRepository } from './data/http/http-goal.repository';
import { HttpLoanRepository } from './data/http/http-loan.repository';
import { HttpInstitutionRepository } from './data/http/http-institution.repository';
import { HttpInvestmentAssetRepository } from './data/http/http-investment-asset.repository';
import { HttpInvestmentTransactionRepository } from './data/http/http-investment-transaction.repository';
import { HttpInvestmentWalletRepository } from './data/http/http-investment-wallet.repository';
import { HttpManualRateRepository } from './data/http/http-manual-rate.repository';
import { HttpMarketDataCredentialRepository } from './data/http/http-market-data-credential.repository';
import { HttpRecurringRuleRepository } from './data/http/http-recurring-rule.repository';
import { HttpTransactionRepository } from './data/http/http-transaction.repository';
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
    { provide: AccountRepository, useClass: HttpAccountRepository },
    { provide: AgentProviderRepository, useClass: HttpAgentProviderRepository },
    { provide: TransactionRepository, useClass: HttpTransactionRepository },
    { provide: CategoryGroupRepository, useClass: HttpCategoryGroupRepository },
    { provide: CategoryRepository, useClass: HttpCategoryRepository },
    { provide: BudgetRepository, useClass: HttpBudgetRepository },
    { provide: BudgetPlanRepository, useClass: HttpBudgetPlanRepository },
    { provide: GoalRepository, useClass: HttpGoalRepository },
    { provide: LoanRepository, useClass: HttpLoanRepository },
    { provide: RecurringRuleRepository, useClass: HttpRecurringRuleRepository },
    { provide: CategorizationRuleRepository, useClass: HttpCategorizationRuleRepository },
    { provide: ExchangeRateRepository, useClass: HttpExchangeRateRepository },
    { provide: InstitutionRepository, useClass: HttpInstitutionRepository },
    { provide: ManualRateRepository, useClass: HttpManualRateRepository },
    { provide: InvestmentWalletRepository, useClass: HttpInvestmentWalletRepository },
    { provide: InvestmentAssetRepository, useClass: HttpInvestmentAssetRepository },
    { provide: InvestmentTransactionRepository, useClass: HttpInvestmentTransactionRepository },
    { provide: MarketDataCredentialRepository, useClass: HttpMarketDataCredentialRepository },
  ],
};
