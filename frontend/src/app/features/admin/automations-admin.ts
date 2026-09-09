import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { IdentityApiService } from '../../core/identity-api.service';
import { JobHealth, JobState } from '../../core/identity.models';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { PageHeader } from '../../shared/ui/page-header/page-header';

@Component({
  selector: 'app-automations-admin',
  imports: [TranslocoDirective, DatePipe, Button, Card, PageHeader],
  templateUrl: './automations-admin.html',
  styleUrl: './automations-admin.scss',
})
export class AutomationsAdmin {
  private readonly api = inject(IdentityApiService);
  protected readonly jobs = signal<JobHealth[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  protected readonly errorCode = signal<string | undefined>(undefined);
  private readonly running = signal(new Set<string>());

  constructor() {
    void this.reload();
  }

  protected async reload(): Promise<void> {
    this.loading.set(true);
    this.loadFailed.set(false);
    this.errorCode.set(undefined);
    try {
      this.jobs.set(await firstValueFrom(this.api.listJobs()));
    } catch {
      this.loadFailed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  protected isRunning(name: string): boolean {
    return this.running().has(name);
  }

  protected needsAttention(job: JobHealth): boolean {
    return ['never_run', 'stale', 'stuck', 'failed', 'partial'].includes(job.state);
  }

  protected stateClass(state: JobState): string {
    const tone =
      state === 'success'
        ? 'bg-positive/10 text-positive'
        : ['stale', 'partial', 'never_run'].includes(state)
          ? 'bg-warning/10 text-warning'
          : ['failed', 'stuck'].includes(state)
            ? 'bg-negative/10 text-negative'
            : 'bg-surface-sunken text-content-muted';
    return `inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${tone}`;
  }

  /** A short label for the dotted task path. */
  protected shortName(name: string): string {
    return name.split('.').pop() ?? name;
  }

  protected async run(job: JobHealth): Promise<void> {
    this.running.update((current) => new Set(current).add(job.name));
    this.errorCode.set(undefined);
    try {
      await firstValueFrom(this.api.runJob(job.name));
      // Re-poll after a short delay so the row reflects the new run.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await this.reload();
    } catch (error) {
      this.errorCode.set(
        typeof error === 'object' && error && 'code' in error
          ? String((error as { code: unknown }).code)
          : 'error.generic',
      );
    } finally {
      this.running.update((current) => {
        const next = new Set(current);
        next.delete(job.name);
        return next;
      });
    }
  }
}
