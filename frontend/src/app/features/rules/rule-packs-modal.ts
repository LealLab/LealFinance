import { Component, effect, inject, model, output, signal } from '@angular/core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { MutationErrorService } from '../../core/mutation-error.service';
import { CategorizationRuleRepository } from '../../data/categorization-rule.repository';
import { RulePack } from '../../domain/models/categorization-rule';
import { Badge } from '../../shared/ui/badge/badge';
import { Button } from '../../shared/ui/button/button';
import { Modal } from '../../shared/ui/modal/modal';

/**
 * Pack names are selected by server code, so mark both supported catalog keys
 * for the static translation extractor.
 *
 * t(rules.packs.names.BR, rules.packs.names.US)
 */
@Component({
  selector: 'app-rule-packs-modal',
  imports: [TranslocoDirective, Modal, Button, Badge],
  templateUrl: './rule-packs-modal.html',
  styleUrl: './rule-packs-modal.scss',
})
export class RulePacksModal {
  private readonly ruleRepository = inject(CategorizationRuleRepository);
  private readonly mutationErrors = inject(MutationErrorService);
  private readonly transloco = inject(TranslocoService);

  readonly open = model.required<boolean>();
  readonly installed = output<void>();

  protected readonly packs = signal<RulePack[]>([]);
  protected readonly installing = signal<string | undefined>(undefined);
  protected readonly resultMessage = signal<string | undefined>(undefined);

  constructor() {
    effect(() => {
      if (this.open()) this.loadPacks();
    });
  }

  protected packFlag(pack: RulePack): string {
    return pack.code === 'BR' ? '🇧🇷' : pack.code === 'US' ? '🇺🇸' : '🏳️';
  }

  protected packName(pack: RulePack): string {
    return this.transloco.translate(`rules.packs.names.${pack.code}`);
  }

  protected installPack(pack: RulePack): void {
    this.installing.set(pack.code);
    this.ruleRepository.installPack(pack.code).subscribe({
      next: ({ installed, skipped }) => {
        this.resultMessage.set(this.transloco.translate('rules.packs.result', { installed, skipped }));
        this.installing.set(undefined);
        this.loadPacks(true);
      },
      error: () => {
        this.installing.set(undefined);
        this.mutationErrors.show();
      },
    });
  }

  private loadPacks(emitInstalled = false): void {
    this.ruleRepository.listPacks().subscribe({
      next: (packs) => {
        this.packs.set(packs);
        if (emitInstalled) this.installed.emit();
      },
      error: () => this.mutationErrors.show(),
    });
  }
}
