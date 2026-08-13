import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard)
  },
  {
    path: 'accounts',
    loadComponent: () => import('./features/accounts/accounts').then((m) => m.Accounts)
  },
  {
    path: 'accounts/:id',
    loadComponent: () => import('./features/accounts/account-detail').then((m) => m.AccountDetail)
  },
  {
    path: 'transactions',
    loadComponent: () => import('./features/transactions/transactions').then((m) => m.Transactions)
  },
  {
    path: 'categories',
    loadComponent: () => import('./features/categories/categories').then((m) => m.Categories)
  },
  {
    path: 'budgets',
    loadComponent: () => import('./features/budgets/budgets').then((m) => m.Budgets)
  },
  {
    path: 'goals',
    loadComponent: () => import('./features/goals/goals').then((m) => m.Goals)
  },
  {
    path: 'reports',
    loadComponent: () => import('./features/reports/reports').then((m) => m.Reports)
  },
  {
    path: 'settings',
    loadComponent: () => import('./features/settings/settings').then((m) => m.Settings)
  }
];
