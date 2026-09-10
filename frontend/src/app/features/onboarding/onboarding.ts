import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { AccountRepository } from '../../data/account.repository';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { OnboardingProgressService } from './onboarding-progress.service';

interface OnboardingStep {
  number: number;
  titleKey: string;
  descriptionKey: string;
}

/**
 * Translation keys below are dynamic property paths used by the template:
 * t(onboarding.title, onboarding.description, onboarding.steps.currency.title, onboarding.steps.currency.description, onboarding.steps.account.title, onboarding.steps.account.description, onboarding.steps.transactions.title, onboarding.steps.transactions.description, onboarding.steps.reconcile.title, onboarding.steps.reconcile.description, onboarding.steps.plan.title, onboarding.steps.plan.description, onboarding.actions.continue, onboarding.actions.skip, onboarding.actions.dismiss, onboarding.actions.run, onboarding.actions.import, onboarding.actions.transaction, onboarding.actions.recurring, onboarding.actions.budget)
 */
@Component({
  selector: 'app-onboarding',
  imports: [TranslocoDirective, Button, Card, PageHeader],
  templateUrl: './onboarding.html',
  styleUrl: './onboarding.scss',
})
export class Onboarding {
  private readonly router = inject(Router);
  private readonly accountRepository = inject(AccountRepository);
  protected readonly progress = inject(OnboardingProgressService);

  protected readonly step = this.progress.step;
  protected readonly createdAccountId = this.progress.createdAccountId;
  protected readonly steps: readonly OnboardingStep[] = [
    {
      number: 1,
      titleKey: 'onboarding.steps.currency.title',
      descriptionKey: 'onboarding.steps.currency.description',
    },
    {
      number: 2,
      titleKey: 'onboarding.steps.account.title',
      descriptionKey: 'onboarding.steps.account.description',
    },
    {
      number: 3,
      titleKey: 'onboarding.steps.transactions.title',
      descriptionKey: 'onboarding.steps.transactions.description',
    },
    {
      number: 4,
      titleKey: 'onboarding.steps.reconcile.title',
      descriptionKey: 'onboarding.steps.reconcile.description',
    },
    {
      number: 5,
      titleKey: 'onboarding.steps.plan.title',
      descriptionKey: 'onboarding.steps.plan.description',
    },
  ];

  constructor() {
    if (this.step() >= 2 && !this.createdAccountId()) {
      this.adoptMostRecentAccount();
    }
  }

  protected continue(): void {
    switch (this.step()) {
      case 1:
        this.visit(2, ['/settings'], { fragment: 'settings-display-currency' });
        break;
      case 2:
        void this.router.navigate(['/accounts'], { queryParams: { new: '1' } });
        break;
      case 3:
        this.visit(4, ['/transactions', 'import']);
        break;
      case 4:
        this.visit(5, ['/reconciliation'], {
          queryParams: this.createdAccountId() ? { accountId: this.createdAccountId() } : undefined,
        });
        break;
      case 5:
        void this.router.navigate(['/transactions'], { queryParams: { tab: 'recurring' } });
        break;
    }
  }

  protected addFirstTransaction(): void {
    this.visit(4, ['/transactions'], { queryParams: { new: '1' } });
  }

  protected setUpBudget(): void {
    void this.router.navigate(['/budgets'], { queryParams: { new: '1' } });
  }

  protected skipStep(): void {
    if (this.step() === 5) {
      this.dismissSetup();
      return;
    }
    this.progress.setStep(this.step() + 1);
  }

  protected dismissSetup(): void {
    this.progress.dismiss();
    void this.router.navigate(['/']);
  }

  private visit(
    nextStep: number,
    commands: string[],
    extras?: Parameters<Router['navigate']>[1],
  ): void {
    this.progress.setStep(nextStep);
    void this.router.navigate(commands, extras);
  }

  private adoptMostRecentAccount(): void {
    this.accountRepository
      .list()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (accounts) => {
          if (this.createdAccountId() || accounts.length === 0) return;
          this.progress.setCreatedAccountId(accounts[accounts.length - 1].id);
          if (this.step() === 2) this.progress.setStep(3);
        },
        error: () => undefined,
      });
  }
}
