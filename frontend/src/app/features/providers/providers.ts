import { Component, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { TranslocoDirective } from '@jsverse/transloco';
import { TranslocoLocaleService } from '@jsverse/transloco-locale';
import { ConfirmService } from '../../core/confirm.service';
import { AgentChatRepository } from '../../data/agent-chat.repository';
import { AgentProviderRepository } from '../../data/agent-provider.repository';
import {
  AgentProviderId,
  AgentProviderStatus,
  AgentReasoningEffort,
} from '../../domain/models/agent-provider';
import { McpToken } from '../../domain/models/agent-chat';
import { Badge } from '../../shared/ui/badge/badge';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { Modal } from '../../shared/ui/modal/modal';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { ProviderLinkModal } from './provider-link-modal';

/**
 * t(providers.status.configuredUser, providers.status.configuredEnv, providers.status.notConfigured, providers.names.anthropic, providers.names.openai, providers.names.ollama, providers.experimental, providers.unlinkError, providers.testOk, providers.testFailed, providers.model.label, providers.model.recommendedOption, providers.model.customOption, providers.model.customPlaceholder, providers.modelError, providers.effort.label, providers.mcpHelpLabel, providers.mcpHelp.title, providers.mcpHelp.steps.enableAgents, providers.mcpHelp.steps.exposeServer, providers.mcpHelp.steps.generateToken, providers.mcpHelp.steps.configureClient, providers.mcpHelp.steps.stdioBridge, providers.mcpHelp.steps.writeSafety, providers.mcpHelp.httpsNote)
 *
 * The literal keys passed to `confirmService.confirm(...)` below are real
 * string literals but aren't calls to the `t` marker function, so
 * transloco-keys-manager's extractor never sees them - same situation as
 * exchange.ts: t(providers.unlink.title, providers.unlink.message)
 */

@Component({
  selector: 'app-providers',
  imports: [TranslocoDirective, Badge, Button, Card, Modal, PageHeader, ProviderLinkModal],
  templateUrl: './providers.html',
  styleUrl: './providers.scss',
})
export class Providers {
  private readonly repository = inject(AgentProviderRepository);
  private readonly agentChatRepo = inject(AgentChatRepository);
  private readonly confirmService = inject(ConfirmService);
  private readonly locale = inject(TranslocoLocaleService);

  protected readonly providersResource = rxResource({ stream: () => this.repository.list() });

  protected readonly linkModalOpen = signal(false);
  protected readonly linkModalProvider = signal<AgentProviderStatus | undefined>(undefined);
  protected readonly customModelProvider = signal<AgentProviderId | undefined>(undefined);
  protected readonly mcpHelpOpen = signal(false);
  protected readonly actionErrorKey = signal<string | undefined>(undefined);
  protected readonly testResult = signal<{ provider: AgentProviderId; ok: boolean } | undefined>(
    undefined,
  );
  protected readonly mcpToken = signal<McpToken | undefined>(undefined);
  protected readonly mcpBusy = signal(false);
  protected readonly mcpCopied = signal(false);
  protected readonly mcpError = signal(false);

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

  protected chooseModel(provider: AgentProviderStatus, model: string): void {
    if (model === '__custom__') {
      this.customModelProvider.set(provider.provider);
      return;
    }
    this.customModelProvider.set(undefined);
    this.setModel(provider, model);
  }

  protected setCustomModel(provider: AgentProviderStatus, model: string): void {
    const trimmed = model.trim();
    if (!trimmed) return;
    // Keep the input open until the save succeeds so a failed attempt can be retried.
    this.setModel(provider, trimmed, () => this.customModelProvider.set(undefined));
  }

  protected setModel(provider: AgentProviderStatus, model: string, onSaved?: () => void): void {
    this.repository.link(provider.provider, { model }).subscribe({
      next: () => {
        onSaved?.();
        this.providersResource.reload();
      },
      error: () => this.actionErrorKey.set('providers.modelError'),
    });
  }

  protected setEffort(provider: AgentProviderStatus, reasoningEffort: AgentReasoningEffort): void {
    this.repository.link(provider.provider, { reasoningEffort }).subscribe({
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

  protected generateMcpToken(): void {
    this.mcpBusy.set(true);
    this.mcpToken.set(undefined);
    this.mcpCopied.set(false);
    this.mcpError.set(false);
    this.agentChatRepo.mintMcpToken().subscribe({
      next: (token) => {
        this.mcpToken.set(token);
        this.mcpBusy.set(false);
      },
      error: () => {
        this.mcpBusy.set(false);
        this.mcpError.set(true);
      },
    });
  }

  protected copyMcpToken(): void {
    const token = this.mcpToken()?.token;
    if (!token) return;
    void globalThis.navigator.clipboard?.writeText(token).then(() => this.mcpCopied.set(true));
  }

  protected formatMcpExpiresAt(value: string): string {
    return this.locale.localizeDate(value, undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  protected readonly mcpClientConfig = `{
  "mcpServers": {
    "lealfinance": {
      "type": "http",
      "url": "http://<host>:8001/mcp",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}`;
}
