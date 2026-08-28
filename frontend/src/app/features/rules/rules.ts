import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { ConfirmService } from '../../core/confirm.service';
import { MutationErrorService } from '../../core/mutation-error.service';
import { CategoryGroupRepository } from '../../data/category-group.repository';
import { CategoryRepository } from '../../data/category.repository';
import { CategorizationRuleRepository } from '../../data/categorization-rule.repository';
import {
  CategorizationRule,
  RuleExportFile,
  RuleExportItem,
} from '../../domain/models/categorization-rule';
import { ruleConditionSummary } from '../../domain/calc/rule-summary';
import { Badge } from '../../shared/ui/badge/badge';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Icon } from '../../shared/ui/icon/icon';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { RuleFormModal } from './rule-form-modal';
import { RULE_FIELD_LABEL_KEYS, RULE_MATCH_LABEL_KEYS, RULE_OP_LABEL_KEYS } from './rule-condition-labels';
import { RulePacksModal } from './rule-packs-modal';

type RuleSortKey = 'priority' | 'name' | 'category';

/**
 * Dynamic keys below are either stored in label maps or selected at runtime,
 * so they need explicit transloco extractor markers.
 *
 * t(rules.actions.edit, rules.actions.delete, rules.import.done, rules.import.invalid, rules.reapply.done, rules.conditions.fields.description, rules.conditions.fields.notes, rules.conditions.fields.amount, rules.conditions.fields.type, rules.conditions.ops.contains, rules.conditions.ops.not_contains, rules.conditions.ops.equals, rules.conditions.ops.not_equals, rules.conditions.ops.starts_with, rules.conditions.ops.ends_with, rules.conditions.ops.regex, rules.conditions.ops.gt, rules.conditions.ops.gte, rules.conditions.ops.lt, rules.conditions.ops.lte, rules.conditions.join.and, rules.conditions.join.or)
 */
@Component({
  selector: 'app-rules',
  imports: [
    TranslocoDirective,
    Badge,
    Button,
    Card,
    EmptyState,
    Icon,
    PageHeader,
    Skeleton,
    RuleFormModal,
    RulePacksModal,
  ],
  templateUrl: './rules.html',
  styleUrl: './rules.scss',
})
export class Rules {
  private readonly ruleRepository = inject(CategorizationRuleRepository);
  private readonly categoryRepository = inject(CategoryRepository);
  private readonly categoryGroupRepository = inject(CategoryGroupRepository);
  private readonly confirmService = inject(ConfirmService);
  private readonly mutationErrors = inject(MutationErrorService);
  private readonly transloco = inject(TranslocoService);

  protected readonly rulesResource = rxResource({ stream: () => this.ruleRepository.list() });
  protected readonly categoriesResource = rxResource({ stream: () => this.categoryRepository.list() });
  protected readonly groupsResource = rxResource({ stream: () => this.categoryGroupRepository.list() });

  protected readonly rules = computed(() => this.rulesResource.value() ?? []);
  protected readonly categories = computed(() => this.categoriesResource.value() ?? []);
  protected readonly sortKey = signal<RuleSortKey>('priority');
  protected readonly asc = signal(true);
  protected readonly formOpen = signal(false);
  protected readonly packsOpen = signal(false);
  protected readonly editingRule = signal<CategorizationRule | undefined>(undefined);
  protected readonly overwrite = signal(false);
  protected readonly resultMessage = signal<string | undefined>(undefined);
  protected readonly importError = signal<string | undefined>(undefined);

  protected readonly sortedRules = computed(() => {
    const categoryNames = new Map(this.categories().map((category) => [category.id, category.name]));
    const direction = this.asc() ? 1 : -1;
    return [...this.rules()].sort((a, b) => {
      const result = this.sortKey() === 'priority'
        ? a.priority - b.priority
        : this.sortKey() === 'name'
          ? a.name.localeCompare(b.name)
          : (categoryNames.get(a.categoryId) ?? '').localeCompare(categoryNames.get(b.categoryId) ?? '');
      return direction * result;
    });
  });

  protected toggleSort(key: RuleSortKey): void {
    if (this.sortKey() === key) {
      this.asc.update((value) => !value);
      return;
    }
    this.sortKey.set(key);
    this.asc.set(true);
  }

  protected openCreate(): void {
    this.editingRule.set(undefined);
    this.formOpen.set(true);
  }

  protected openEdit(rule: CategorizationRule): void {
    this.editingRule.set(rule);
    this.formOpen.set(true);
  }

  protected onSaved(): void {
    this.rulesResource.reload();
  }

  protected categoryName(rule: CategorizationRule): string {
    return this.categories().find((category) => category.id === rule.categoryId)?.name ?? rule.categoryId;
  }

  protected categoryColor(rule: CategorizationRule): string {
    return this.categories().find((category) => category.id === rule.categoryId)?.color ?? 'currentColor';
  }

  protected summary(rule: CategorizationRule): string {
    return ruleConditionSummary(rule, {
      field: (field) => this.transloco.translate(RULE_FIELD_LABEL_KEYS[field]),
      op: (op) => this.transloco.translate(RULE_OP_LABEL_KEYS[op]),
      join: (op) => this.transloco.translate(RULE_MATCH_LABEL_KEYS[op]).trim(),
    });
  }

  protected async deleteRule(rule: CategorizationRule): Promise<void> {
    const confirmed = await this.confirmService.confirm(
      'rules.delete.title',
      'rules.delete.message',
      'danger',
      { name: rule.name },
    );
    if (!confirmed) return;

    this.ruleRepository.delete(rule.id).subscribe({
      next: () => this.rulesResource.reload(),
      error: () => this.mutationErrors.show(),
    });
  }

  protected exportRules(): void {
    const file: RuleExportFile = {
      format: 'lealfinance-categorization-rules',
      version: 1,
      rules: this.rules().map<RuleExportItem>((rule) => ({
        name: rule.name,
        matchOp: rule.matchOp,
        priority: rule.priority,
        isActive: rule.isActive,
        category: this.categoryName(rule),
        conditions: rule.conditions,
      })),
    };
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = 'lealfinance-categorization-rules.json';
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  protected async onImportFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.importError.set(undefined);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      this.showInvalidImport(0);
      return;
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as { format?: unknown }).format !== 'lealfinance-categorization-rules' ||
      !Array.isArray((parsed as { rules?: unknown }).rules)
    ) {
      this.showInvalidImport(0);
      return;
    }

    const importedFile = parsed as RuleExportFile;
    const confirmed = await this.confirmService.confirm(
      'rules.import.title',
      'rules.import.message',
      'default',
      { count: importedFile.rules.length },
    );
    if (!confirmed) return;

    this.ruleRepository.importRules(importedFile.rules, false).subscribe({
      next: ({ imported, skipped }) => {
        this.resultMessage.set(this.transloco.translate('rules.import.done', { imported, skipped }));
        this.rulesResource.reload();
      },
      error: () => this.mutationErrors.show(),
    });
  }

  private showInvalidImport(count: number): void {
    this.importError.set(this.transloco.translate('rules.import.invalid', { count }));
  }

  protected async reapplyRules(): Promise<void> {
    const confirmed = await this.confirmService.confirm(
      'rules.reapply.title',
      'rules.reapply.message',
      'danger',
    );
    if (!confirmed) return;

    this.ruleRepository.reapply(this.overwrite()).subscribe({
      next: (updated) => {
        this.resultMessage.set(this.transloco.translate('rules.reapply.done', { count: updated }));
      },
      error: () => this.mutationErrors.show(),
    });
  }
}
