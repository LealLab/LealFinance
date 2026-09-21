import { Component, inject, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { TranslocoLocaleService } from '@jsverse/transloco-locale';
import { firstValueFrom } from 'rxjs';
import { ApiError } from '../../core/api-error';
import { ConfirmService } from '../../core/confirm.service';
import { AgentChatRepository } from '../../data/agent-chat.repository';
import { AgentMemory } from '../../domain/models/agent-chat';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';

/** t(settings.memories.removeConfirm.title, settings.memories.removeConfirm.message, errors.agent_memory.not_found) */
@Component({
  selector: 'app-memories-section',
  imports: [TranslocoDirective, Button, Card],
  templateUrl: './memories-section.html',
  styleUrl: './memories-section.scss',
})
export class MemoriesSection {
  private readonly repo = inject(AgentChatRepository);
  private readonly confirm = inject(ConfirmService);
  private readonly locale = inject(TranslocoLocaleService);

  protected readonly memories = signal<AgentMemory[]>([]);
  protected readonly loaded = signal(false);
  protected readonly loadError = signal(false);
  protected readonly busy = signal(false);
  /** Backend error code, rendered as `errors.<code>`. */
  protected readonly errorCode = signal<string | undefined>(undefined);

  constructor() {
    this.load();
  }

  protected formatDate(value: string): string {
    return this.locale.localizeDate(value, undefined, { dateStyle: 'medium' });
  }

  protected async remove(memory: AgentMemory): Promise<void> {
    if (
      this.busy() ||
      !(await this.confirm.confirm(
        'settings.memories.removeConfirm.title',
        'settings.memories.removeConfirm.message',
        'danger',
      ))
    ) {
      return;
    }
    this.busy.set(true);
    this.errorCode.set(undefined);
    try {
      await firstValueFrom(this.repo.deleteMemory(memory.id));
      this.memories.update((rows) => rows.filter((row) => row.id !== memory.id));
    } catch (error) {
      this.errorCode.set(error instanceof ApiError ? error.code : 'error.generic');
      // It may already be gone (another tab); show what is really stored.
      this.load();
    } finally {
      this.busy.set(false);
    }
  }

  private load(): void {
    this.repo.listMemories().subscribe({
      next: (rows) => {
        this.memories.set(rows);
        this.loadError.set(false);
        this.loaded.set(true);
      },
      error: () => this.loadError.set(true),
    });
  }
}
