import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { ApiError } from '../../core/api-error';
import { CategorizationRuleRepository } from '../../data/categorization-rule.repository';
import { Category } from '../../domain/models/category';
import { CategoryGroup } from '../../domain/models/category-group';
import {
  CategorizationRule,
  isConditionGroup,
  RuleAmountOp,
  RuleConditionEntry,
  RuleConditionField,
  RuleConditionOp,
  RuleLeafCondition,
  RuleMatchOp,
  RuleTextOp,
} from '../../domain/models/categorization-rule';
import { Button } from '../../shared/ui/button/button';
import { Modal } from '../../shared/ui/modal/modal';
import { groupCategoriesByGroup } from '../transactions/category-grouping';

const CONDITION_FIELDS: readonly RuleConditionField[] = ['description', 'notes', 'amount', 'type'];
const TEXT_OPS: readonly RuleTextOp[] = [
  'contains',
  'not_contains',
  'equals',
  'not_equals',
  'starts_with',
  'ends_with',
  'regex',
];
const AMOUNT_OPS: readonly RuleAmountOp[] = ['equals', 'gt', 'gte', 'lt', 'lte'];
const TYPE_OPS: readonly RuleTextOp[] = ['equals', 'not_equals'];

/**
 * Dynamic translation keys and backend error codes used by this modal need
 * extractor markers.
 *
 * t(rules.form.newTitle, rules.form.editTitle, rules.form.saveError, rules.form.badRegex, rules.form.needCondition, rules.form.blankValue, errors.categorization_rule.duplicate_name, errors.categorization_rule.not_found, errors.categorization_rule.no_conditions, errors.categorization_rule.invalid_operator, errors.categorization_rule.blank_value, errors.categorization_rule.invalid_regex, errors.categorization_rule.invalid_amount, errors.categorization_rule.invalid_type_value)
 */
@Component({
  selector: 'app-rule-form-modal',
  imports: [ReactiveFormsModule, TranslocoDirective, Modal, Button],
  templateUrl: './rule-form-modal.html',
})
export class RuleFormModal {
  private readonly ruleRepository = inject(CategorizationRuleRepository);
  private readonly fb = inject(FormBuilder);

  readonly open = model.required<boolean>();
  readonly rule = input<CategorizationRule | undefined>();
  readonly categories = input.required<Category[]>();
  readonly groups = input.required<CategoryGroup[]>();
  readonly saved = output<void>();

  protected readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    priority: [10, [Validators.required, Validators.min(0)]],
    isActive: [true],
    categoryId: ['', Validators.required],
    matchOp: ['and' as RuleMatchOp],
  });
  protected readonly conditions = signal<RuleConditionEntry[]>([]);
  protected readonly saving = signal(false);
  protected readonly saveErrorKey = signal<string | null>(null);
  protected readonly conditionFields = CONDITION_FIELDS;
  protected readonly matchOps: readonly RuleMatchOp[] = ['and', 'or'];
  protected readonly groupedCategories = computed(() =>
    groupCategoriesByGroup(this.categories(), this.groups()),
  );
  protected readonly isConditionGroup = isConditionGroup;

  protected readonly titleKey = computed(() =>
    this.rule() ? 'rules.form.editTitle' : 'rules.form.newTitle',
  );

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const rule = this.rule();
      this.form.reset({
        name: rule?.name ?? '',
        priority: rule?.priority ?? 10,
        isActive: rule?.isActive ?? true,
        categoryId: rule?.categoryId ?? '',
        matchOp: rule?.matchOp ?? 'and',
      });
      this.conditions.set(rule ? this.cloneConditions(rule.conditions) : [this.defaultLeaf()]);
      this.saveErrorKey.set(null);
      this.saving.set(false);
    });
  }

  protected opsFor(field: RuleConditionField): readonly RuleConditionOp[] {
    if (field === 'amount') return AMOUNT_OPS;
    if (field === 'type') return TYPE_OPS;
    return TEXT_OPS;
  }

  protected setMatchOp(op: RuleMatchOp): void {
    this.form.controls.matchOp.setValue(op);
  }

  protected setEntryField(index: number, field: RuleConditionField): void {
    this.updateLeaf({ leafIndex: index }, { field, op: this.defaultOp(field), value: this.defaultValue(field) });
  }

  protected setEntryOp(index: number, op: RuleConditionOp): void {
    this.updateLeaf({ leafIndex: index }, { op });
  }

  protected setEntryValue(index: number, value: string): void {
    this.updateLeaf({ leafIndex: index }, { value });
  }

  protected setGroupOp(index: number, op: RuleMatchOp): void {
    this.conditions.update((entries) =>
      entries.map((entry, entryIndex) =>
        entryIndex === index && isConditionGroup(entry) ? { ...entry, op } : entry,
      ),
    );
  }

  protected setGroupField(groupIndex: number, leafIndex: number, field: RuleConditionField): void {
    this.updateLeaf(
      { groupIndex, leafIndex },
      { field, op: this.defaultOp(field), value: this.defaultValue(field) },
    );
  }

  protected setGroupOpValue(groupIndex: number, leafIndex: number, op: RuleConditionOp): void {
    this.updateLeaf({ groupIndex, leafIndex }, { op });
  }

  protected setGroupValue(groupIndex: number, leafIndex: number, value: string): void {
    this.updateLeaf({ groupIndex, leafIndex }, { value });
  }

  protected addCondition(): void {
    this.conditions.update((entries) => [...entries, this.defaultLeaf()]);
  }

  protected addGroup(): void {
    this.conditions.update((entries) => [...entries, { op: 'and', conditions: [this.defaultLeaf()] }]);
  }

  protected addConditionToGroup(index: number): void {
    this.conditions.update((entries) =>
      entries.map((entry, entryIndex) =>
        entryIndex === index && isConditionGroup(entry)
          ? { ...entry, conditions: [...entry.conditions, this.defaultLeaf()] }
          : entry,
      ),
    );
  }

  protected removeEntry(index: number): void {
    this.conditions.update((entries) => entries.filter((_, entryIndex) => entryIndex !== index));
  }

  protected removeGroupCondition(groupIndex: number, leafIndex: number): void {
    this.conditions.update((entries) =>
      entries.map((entry, entryIndex) =>
        entryIndex === groupIndex && isConditionGroup(entry)
          ? { ...entry, conditions: entry.conditions.filter((_, index) => index !== leafIndex) }
          : entry,
      ),
    );
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const leaves = this.conditions().flatMap((entry) =>
      isConditionGroup(entry) ? entry.conditions : [entry],
    );
    if (leaves.length === 0) {
      this.saveErrorKey.set('rules.form.needCondition');
      return;
    }
    if (leaves.some((condition) => !condition.value.trim())) {
      this.saveErrorKey.set('rules.form.blankValue');
      return;
    }
    if (
      leaves.some((condition) => {
        if (condition.op !== 'regex') return false;
        try {
          new RegExp(condition.value);
          return false;
        } catch {
          return true;
        }
      })
    ) {
      this.saveErrorKey.set('rules.form.badRegex');
      return;
    }

    const raw = this.form.getRawValue();
    const payload: Omit<CategorizationRule, 'id'> = {
      name: raw.name.trim(),
      priority: raw.priority,
      isActive: raw.isActive,
      matchOp: raw.matchOp,
      categoryId: raw.categoryId,
      conditions: this.trimConditions(this.conditions()),
    };
    this.saving.set(true);
    const existing = this.rule();
    const request$ = existing
      ? this.ruleRepository.update(existing.id, payload)
      : this.ruleRepository.create(payload);
    request$.subscribe({
      next: () => {
        this.saving.set(false);
        this.open.set(false);
        this.saved.emit();
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.saveErrorKey.set(error instanceof ApiError ? `errors.${error.code}` : 'rules.form.saveError');
      },
    });
  }

  private defaultLeaf(): RuleLeafCondition {
    return { field: 'description', op: 'contains', value: '' };
  }

  private defaultOp(field: RuleConditionField): RuleConditionOp {
    return field === 'description' || field === 'notes' ? 'contains' : 'equals';
  }

  private defaultValue(field: RuleConditionField): string {
    return field === 'type' ? 'expense' : '';
  }

  private updateLeaf(
    location: { groupIndex?: number; leafIndex: number },
    changes: Partial<RuleLeafCondition>,
  ): void {
    this.conditions.update((entries) =>
      entries.map((entry, entryIndex) => {
        if (location.groupIndex === undefined) {
          return entryIndex === location.leafIndex && !isConditionGroup(entry)
            ? { ...entry, ...changes }
            : entry;
        }
        if (entryIndex !== location.groupIndex || !isConditionGroup(entry)) return entry;
        return {
          ...entry,
          conditions: entry.conditions.map((condition, conditionIndex) =>
            conditionIndex === location.leafIndex ? { ...condition, ...changes } : condition,
          ),
        };
      }),
    );
  }

  private cloneConditions(entries: RuleConditionEntry[]): RuleConditionEntry[] {
    return entries.map((entry) =>
      isConditionGroup(entry)
        ? { ...entry, conditions: entry.conditions.map((condition) => ({ ...condition })) }
        : { ...entry },
    );
  }

  private trimConditions(entries: RuleConditionEntry[]): RuleConditionEntry[] {
    return entries.map((entry) =>
      isConditionGroup(entry)
        ? { ...entry, conditions: entry.conditions.map((condition) => ({ ...condition, value: condition.value.trim() })) }
        : { ...entry, value: entry.value.trim() },
    );
  }
}
