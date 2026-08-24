import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { IdentityApiService } from '../../core/identity-api.service';
import { UpdateStatus } from '../../core/identity.models';
import { SessionService } from '../../core/session.service';
import { Button } from '../../shared/ui/button/button';
import { Modal } from '../../shared/ui/modal/modal';

const DISMISSED_VERSION_KEY = 'lealfinance.dismissedUpdateVersion';

/**
 * Admin-only "a newer version exists" banner. Members never see it and the
 * endpoint is never called for them - the fetch below is gated on the
 * session's role before it ever subscribes, not just hidden by the
 * template's `@if`.
 */
@Component({
  selector: 'app-update-banner',
  imports: [TranslocoDirective, Button, Modal],
  templateUrl: './update-banner.html',
  styleUrl: './update-banner.scss',
})
export class UpdateBanner {
  private readonly identityApi = inject(IdentityApiService);
  private readonly session = inject(SessionService);

  private readonly status = signal<UpdateStatus | null>(null);
  private readonly dismissedVersion = signal(
    typeof localStorage !== 'undefined' ? localStorage.getItem(DISMISSED_VERSION_KEY) : null,
  );

  protected readonly modalOpen = signal(false);
  protected readonly latestVersion = computed(() => this.status()?.latestVersion);
  protected readonly releaseUrl = computed(() => this.status()?.releaseUrl);
  protected readonly visible = computed(
    () => !!this.status()?.updateAvailable && this.dismissedVersion() !== this.latestVersion(),
  );

  constructor() {
    if (this.session.user()?.role !== 'admin') return;
    this.identityApi.updateStatus().subscribe({
      next: (result) => this.status.set(result),
      error: () => undefined,
    });
  }

  protected dismiss(): void {
    const version = this.latestVersion();
    if (version) localStorage.setItem(DISMISSED_VERSION_KEY, version);
    this.dismissedVersion.set(version ?? null);
  }

  protected openModal(): void {
    this.modalOpen.set(true);
  }
}
