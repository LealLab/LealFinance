import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { OpenFinanceRepository } from '../../data/open-finance.repository';
import { PluggyCredentialStatus, PluggyEnvironment } from '../../domain/models/open-finance';
import { Button } from '../../shared/ui/button/button';
import { Badge } from '../../shared/ui/badge/badge';
import { Card } from '../../shared/ui/card/card';

/** t(openFinance.credentials.title, openFinance.credentials.description, openFinance.credentials.configured, openFinance.credentials.fields.clientId, openFinance.credentials.fields.clientSecret, openFinance.credentials.fields.environment, openFinance.credentials.sandbox, openFinance.credentials.production, openFinance.credentials.actions.save, openFinance.credentials.actions.unlink, openFinance.credentials.actions.saving, openFinance.credentials.saveError, openFinance.credentials.unlinkError) */
@Component({
  selector: 'app-pluggy-credentials-section',
  imports: [ReactiveFormsModule, TranslocoDirective, Badge, Button, Card],
  templateUrl: './pluggy-credentials-section.html',
  styleUrl: './pluggy-credentials-section.scss',
})
export class PluggyCredentialsSection {
  private readonly repository = inject(OpenFinanceRepository);
  private readonly fb = inject(FormBuilder);

  readonly status = input<PluggyCredentialStatus | undefined>();
  readonly changed = output<void>();

  protected readonly saving = signal(false);
  protected readonly errorKey = signal<string | undefined>(undefined);
  protected readonly form = this.fb.nonNullable.group({
    clientId: ['', Validators.required],
    clientSecret: ['', Validators.required],
    environment: this.fb.nonNullable.control<PluggyEnvironment>('sandbox', Validators.required),
  });

  constructor() {
    effect(() => {
      const environment = this.status()?.environment;
      if (environment) this.form.controls.environment.setValue(environment);
    });
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const clientId = value.clientId.trim();
    const clientSecret = value.clientSecret.trim();
    if (!clientId || !clientSecret) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.errorKey.set(undefined);
    this.repository.linkCredentials(clientId, clientSecret, value.environment).subscribe({
      next: () => {
        this.saving.set(false);
        this.form.controls.clientSecret.reset('');
        this.changed.emit();
      },
      error: () => {
        this.saving.set(false);
        this.errorKey.set('openFinance.credentials.saveError');
      },
    });
  }

  protected unlink(): void {
    this.saving.set(true);
    this.errorKey.set(undefined);
    this.repository.unlinkCredentials().subscribe({
      next: () => {
        this.saving.set(false);
        this.form.reset({ clientId: '', clientSecret: '', environment: 'sandbox' });
        this.changed.emit();
      },
      error: () => {
        this.saving.set(false);
        this.errorKey.set('openFinance.credentials.unlinkError');
      },
    });
  }
}
