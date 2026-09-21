import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { TranslocoLocaleService } from '@jsverse/transloco-locale';
import { IdentityApiService } from '../../core/identity-api.service';
import { UpdateStatus } from '../../core/identity.models';
import { SessionService } from '../../core/session.service';
import { MarkdownPipe } from '../../shared/pipes/markdown.pipe';
import { Button } from '../../shared/ui/button/button';
import { Modal } from '../../shared/ui/modal/modal';

const DISMISSED_VERSION_KEY = 'lealfinance.dismissedUpdateVersion';
const BACKUP_DOCS_URL =
  'https://github.com/LealLab/LealFinance/blob/main/docs/homelab-deploy.md#backups';

/**
 * Admin-only "a newer version exists" banner. Members never see it and the
 * endpoint is never called for them - the fetch below is gated on the
 * session's role before it ever subscribes, not just hidden by the
 * template's `@if`.
 *
 * The banner opens three modals - update instructions, backup instructions and
 * release notes. Only the two explicit "on GitHub" buttons leave the app.
 */
@Component({
  selector: 'app-update-banner',
  imports: [NgTemplateOutlet, TranslocoDirective, Button, Modal],
  templateUrl: './update-banner.html',
  styleUrls: ['./update-banner.scss', '../../shared/styles/markdown.scss'],
})
export class UpdateBanner {
  private readonly identityApi = inject(IdentityApiService);
  private readonly session = inject(SessionService);
  private readonly locale = inject(TranslocoLocaleService);

  private readonly status = signal<UpdateStatus | null>(null);
  private readonly dismissedVersion = signal(
    typeof localStorage !== 'undefined' ? localStorage.getItem(DISMISSED_VERSION_KEY) : null,
  );

  protected readonly modalOpen = signal(false);
  /** The command whose copy button was last used, for the "Copied" label. */
  protected readonly copiedCommand = signal<string | null>(null);
  protected readonly backupModalOpen = signal(false);
  protected readonly notesModalOpen = signal(false);
  protected readonly backupDocsUrl = BACKUP_DOCS_URL;
  protected readonly latestVersion = computed(() => this.status()?.latestVersion);
  protected readonly releaseUrl = computed(() => this.status()?.releaseUrl);
  // Links in the notes (mostly PR links) open in a new tab so reading them
  // never navigates the app away.
  protected readonly releaseNotesHtml = computed(() =>
    new MarkdownPipe()
      .transform(this.status()?.releaseNotes)
      .replaceAll('<a ', '<a target="_blank" rel="noopener noreferrer" '),
  );
  protected readonly publishedDate = computed(() => {
    const value = this.status()?.publishedAt;
    return value ? this.locale.localizeDate(value, undefined, { dateStyle: 'medium' }) : undefined;
  });
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

  protected copy(command: string): void {
    const clipboard = globalThis.navigator.clipboard;
    if (!clipboard) return;
    void clipboard
      .writeText(command)
      .then(() => {
        this.copiedCommand.set(command);
        setTimeout(() => this.copiedCommand.set(null), 2000);
      })
      .catch(() => undefined);
  }

  protected openModal(): void {
    this.modalOpen.set(true);
  }

  // The backup and notes modals stack over the update modal, so closing one
  // returns to the instructions instead of dropping out of the flow.
  protected openBackupModal(): void {
    this.backupModalOpen.set(true);
  }

  protected openNotesModal(): void {
    this.notesModalOpen.set(true);
  }
}
