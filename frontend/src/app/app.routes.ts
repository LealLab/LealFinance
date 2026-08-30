import { Routes } from '@angular/router';
import { adminGuard, agentsGuard, authGuard, investmentsGuard } from './core/auth.guards';
import { Shell } from './layout/shell';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login').then((m) => m.Login),
  },
  {
    path: 'register',
    loadComponent: () => import('./features/auth/register').then((m) => m.Register),
  },
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    children: [
      {
        path: '',
        loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
      },
      {
        path: 'accounts',
        loadComponent: () => import('./features/accounts/accounts').then((m) => m.Accounts),
      },
      {
        path: 'accounts/:id',
        loadComponent: () =>
          import('./features/accounts/account-detail').then((m) => m.AccountDetail),
      },
      {
        path: 'transactions',
        loadComponent: () =>
          import('./features/transactions/transactions').then((m) => m.Transactions),
      },
      {
        path: 'transactions/import',
        loadComponent: () =>
          import('./features/transactions/import/transaction-import').then(
            (m) => m.TransactionImport,
          ),
      },
      {
        path: 'categories',
        loadComponent: () => import('./features/categories/categories').then((m) => m.Categories),
      },
      {
        path: 'rules',
        loadComponent: () => import('./features/rules/rules').then((m) => m.Rules),
      },
      {
        path: 'budgets',
        loadComponent: () => import('./features/budgets/budgets').then((m) => m.Budgets),
      },
      {
        path: 'goals',
        loadComponent: () => import('./features/goals/goals').then((m) => m.Goals),
      },
      {
        path: 'loans',
        loadComponent: () => import('./features/loans/loans').then((m) => m.Loans),
      },
      {
        path: 'investments',
        canActivate: [investmentsGuard],
        loadComponent: () =>
          import('./features/investments/investments').then((m) => m.Investments),
      },
      {
        path: 'investments/:id',
        canActivate: [investmentsGuard],
        loadComponent: () =>
          import('./features/investments/investment-detail').then((m) => m.InvestmentDetail),
      },
      {
        path: 'reports',
        loadComponent: () => import('./features/reports/reports').then((m) => m.Reports),
      },
      {
        path: 'exchange',
        loadComponent: () => import('./features/exchange/exchange').then((m) => m.Exchange),
      },
      {
        path: 'settings',
        loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
      },
      {
        path: 'admin/users',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/users-admin').then((m) => m.UsersAdmin),
      },
      {
        path: 'admin/providers',
        canActivate: [adminGuard, agentsGuard],
        loadComponent: () => import('./features/providers/providers').then((m) => m.Providers),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
