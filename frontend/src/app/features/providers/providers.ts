import { Component, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { TranslocoDirective } from '@jsverse/transloco';
import { ConfirmService } from '../../core/confirm.service';
import { AgentProviderRepository } from '../../data/agent-provider.repository';
import { AgentChatMessage, AgentProviderId, AgentProviderStatus } from '../../domain/models/agent-provider';
import { Badge } from '../../shared/ui/badge/badge';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { ProviderLinkModal } from './provider-link-modal';

/**
 * t(providers.status.configuredUser, providers.status.configuredEnv, providers.status.notConfigured, providers.names.anthropic, providers.names.openai, providers.names.ollama, providers.unlinkError, providers.testOk, providers.testFailed, providers.chatError, providers.model.label, providers.model.recommendedOption, providers.modelError)
 *
 * The literal keys passed to `confirmService.confirm(...)` below are real
 * string literals but aren't calls to the `t` marker function, so
 * transloco-keys-manager's extractor never sees them - same situation as
 * exchange.ts: t(providers.unlink.title, providers.unlink.message)
 */

@Component({
  selector: 'app-providers',
  imports: [TranslocoDirective, Badge, Button, Card, PageHeader, ProviderLinkModal],
  templateUrl: './providers.html',
  styleUrl: './providers.scss',
})
export class Providers {
  private readonly repository = inject(AgentProviderRepository);
  private readonly confirmService = inject(ConfirmService);

  protected readonly providersResource = rxResource({ stream: () => this.repository.list() });

  protected readonly linkModalOpen = signal(false);
  protected readonly linkModalProvider = signal<AgentProviderStatus | undefined>(undefined);
  protected readonly actionErrorKey = signal<string | undefined>(undefined);
  protected readonly testResult = signal<{ provider: AgentProviderId; ok: boolean } | undefined>(
    undefined,
  );

  protected readonly chatProvider = signal<AgentProviderId | undefined>(undefined);
  protected readonly chatInput = signal('');
  protected readonly chatSending = signal(false);
  protected readonly chatReply = signal<string | undefined>(undefined);
  protected readonly chatErrorKey = signal<string | undefined>(undefined);

  protected openLink(provider: AgentProviderStatus): void {
    this.linkModalProvider.set(provider);
    this.linkModalOpen.set(true);
  }

  protected onLinked(): void {
    this.providersResource.reload();
  }

  protected async unlink(provider: AgentProviderStatus): Promise<void> {
    const confirmed = await this.confirmService.confirm(
      'providers.unlink.title',
      'providers.unlink.message',
      'danger',
    );
    if (!confirmed) return;

    this.repository.unlink(provider.provider).subscribe({
      next: () => this.providersResource.reload(),
      error: () => this.actionErrorKey.set('providers.unlinkError'),
    });
  }

  /** Keeps a stored model that isn't in the catalog (an older or custom
   * value) selectable instead of silently switching to the first option. */
  protected modelOptions(p: AgentProviderStatus): string[] {
    return p.models.includes(p.model) ? p.models : [p.model, ...p.models];
  }

  protected setModel(provider: AgentProviderStatus, model: string): void {
    // ponytail: catalog + current value only. Typing a brand-new model id
    // on an OAuth-linked provider still needs the API-key modal's
    // free-text field; add a "custom…" option if unlisted models become
    // common.
    this.repository.link(provider.provider, { model }).subscribe({
      next: () => this.providersResource.reload(),
      error: () => this.actionErrorKey.set('providers.modelError'),
    });
  }

  protected testConnection(provider: AgentProviderStatus): void {
    this.testResult.set(undefined);
    this.repository.test(provider.provider).subscribe({
      next: (result) => this.testResult.set({ provider: provider.provider, ok: result.ok }),
      error: () => this.testResult.set({ provider: provider.provider, ok: false }),
    });
  }

  protected sendChat(): void {
    const content = this.chatInput().trim();
    if (!content) return;

    const messages: AgentChatMessage[] = [{ role: 'user', content }];
    this.chatSending.set(true);
    this.chatErrorKey.set(undefined);
    this.chatReply.set(undefined);
    this.repository.chat(messages, this.chatProvider()).subscribe({
      next: (result) => {
        this.chatSending.set(false);
        this.chatReply.set(result.reply);
      },
      error: () => {
        this.chatSending.set(false);
        this.chatErrorKey.set('providers.chatError');
      },
    });
  }
}
