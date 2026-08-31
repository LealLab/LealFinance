import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { CategoryGroupRepository } from '../../data/category-group.repository';
import { CategoryRepository } from '../../data/category.repository';
import { Category, CategoryKind } from '../../domain/models/category';
import { CategoryGroup } from '../../domain/models/category-group';
import { Button } from '../../shared/ui/button/button';
import { ColorPicker } from '../../shared/ui/color-picker/color-picker';
import { Icon } from '../../shared/ui/icon/icon';
import { IconPicker } from '../../shared/ui/icon-picker/icon-picker';
import { Modal } from '../../shared/ui/modal/modal';

const DEFAULT_COLOR = '#1F5C6B';
const DEFAULT_ICON = 'tag';

/** Create/edit form for either a CategoryGroup or a Category. */
@Component({
  selector: 'app-category-form-modal',
  imports: [ReactiveFormsModule, TranslocoDirective, Modal, Button, ColorPicker, Icon, IconPicker],
  templateUrl: './category-form-modal.html',
  styleUrl: './category-form-modal.scss'
})
export class CategoryFormModal {
  private readonly categories = inject(CategoryRepository);
  private readonly categoryGroups = inject(CategoryGroupRepository);
  private readonly fb = inject(FormBuilder);

  readonly open = model.required<boolean>();
  readonly mode = input.required<'category' | 'group'>();
  readonly category = input<Category | undefined>(undefined);
  readonly group = input<CategoryGroup | undefined>(undefined);
  readonly presetGroup = input<CategoryGroup | undefined>(undefined);
  readonly allGroups = input.required<CategoryGroup[]>();
  readonly saved = output<Category | CategoryGroup>();

  protected readonly saving = signal(false);
  protected readonly saveErrorKey = signal<string | null>(null);
  protected readonly colorPickerOpen = signal(false);
  protected readonly iconPickerOpen = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    kind: ['expense' as CategoryKind, Validators.required],
    groupId: [''],
    color: [DEFAULT_COLOR, Validators.required],
    icon: [DEFAULT_ICON as Category['icon'], Validators.required]
  });

  private readonly selectedKind = toSignal(this.form.controls.kind.valueChanges, {
    initialValue: this.form.controls.kind.value
  });

  protected readonly selectedIcon = toSignal(this.form.controls.icon.valueChanges, {
    initialValue: this.form.controls.icon.value
  });

  protected readonly selectedColor = toSignal(this.form.controls.color.valueChanges, {
    initialValue: this.form.controls.color.value
  });

  /** True while creating a category via the preset-group shortcut - the kind picker is locked to the group's kind. */
  protected readonly kindLocked = computed(
    () => this.mode() === 'category' && this.category() === undefined && this.presetGroup() !== undefined
  );

  protected readonly groupOptions = computed(() =>
    this.allGroups().filter((group) => group.kind === this.selectedKind())
  );

  /**
   * titleKey/saveErrorKey hold these as plain string literals, only ever
   * reached through the template's translation call - see
   * account-form-modal.ts / layout/sidebar.ts for why that needs this
   * JSDoc "dynamic markings" block:
   * t(categories.form.editTitle, categories.form.newTitle, categories.form.editGroupTitle, categories.form.newGroupTitle, categories.form.saveError)
   */
  protected readonly titleKey = computed(() => {
    if (this.mode() === 'group') {
      return this.group() ? 'categories.form.editGroupTitle' : 'categories.form.newGroupTitle';
    }
    return this.category() ? 'categories.form.editTitle' : 'categories.form.newTitle';
  });

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const category = this.category();
      const group = this.group();
      const preset = category || group ? undefined : this.presetGroup();
      const isCategory = this.mode() === 'category';

      if (isCategory) {
        this.form.controls.groupId.setValidators(Validators.required);
      } else {
        this.form.controls.groupId.clearValidators();
      }
      this.form.controls.groupId.updateValueAndValidity({ emitEvent: false });
      this.form.reset({
        name: category?.name ?? group?.name ?? '',
        kind: category?.kind ?? group?.kind ?? preset?.kind ?? 'expense',
        groupId: category?.groupId ?? preset?.id ?? '',
        color: category?.color ?? group?.color ?? preset?.color ?? DEFAULT_COLOR,
        icon: category?.icon ?? group?.icon ?? DEFAULT_ICON
      });
      this.saveErrorKey.set(null);
    });
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    this.saving.set(true);

    if (this.mode() === 'group') {
      const existing = this.group();
      const payload: Omit<CategoryGroup, 'id' | 'position'> = {
        name: raw.name.trim(),
        kind: raw.kind,
        color: raw.color,
        icon: raw.icon
      };
      const request$ = existing
        ? this.categoryGroups.update(existing.id, payload)
        : this.categoryGroups.create(payload);
      request$.subscribe({
        next: (saved) => this.finishSave(saved),
        error: () => this.failSave()
      });
      return;
    }

    const existing = this.category();
    const payload: Omit<Category, 'id' | 'position'> = {
      name: raw.name.trim(),
      kind: raw.kind,
      groupId: raw.groupId,
      color: raw.color,
      icon: raw.icon
    };
    const request$ = existing
      ? this.categories.update(existing.id, payload)
      : this.categories.create(payload);
    request$.subscribe({
      next: (saved) => this.finishSave(saved),
      error: () => this.failSave()
    });
  }

  private finishSave(saved: Category | CategoryGroup): void {
    this.saving.set(false);
    this.open.set(false);
    this.saved.emit(saved);
  }

  private failSave(): void {
    this.saving.set(false);
    this.saveErrorKey.set('categories.form.saveError');
  }
}
