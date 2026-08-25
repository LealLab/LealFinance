import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { CategoryRepository } from '../../data/category.repository';
import { Category, CategoryKind } from '../../domain/models/category';
import { Button } from '../../shared/ui/button/button';
import { Icon } from '../../shared/ui/icon/icon';
import { IconPicker } from '../../shared/ui/icon-picker/icon-picker';
import { Modal } from '../../shared/ui/modal/modal';

const DEFAULT_COLOR = '#1F5C6B';
const DEFAULT_ICON = 'tag';

/**
 * Create/edit form for a Category. `parentOptions` is restricted to
 * top-level categories of the same kind - categories nest one level deep
 * (see the Category model), so a child can't itself have children, and a
 * category can't become its own parent.
 */
@Component({
  selector: 'app-category-form-modal',
  imports: [ReactiveFormsModule, TranslocoDirective, Modal, Button, Icon, IconPicker],
  templateUrl: './category-form-modal.html',
  styleUrl: './category-form-modal.scss'
})
export class CategoryFormModal {
  private readonly categories = inject(CategoryRepository);
  private readonly fb = inject(FormBuilder);

  readonly open = model.required<boolean>();
  readonly category = input<Category | undefined>(undefined);
  readonly allCategories = input.required<Category[]>();
  /**
   * When set and the modal opens for a *new* category (not editing), the
   * form is pre-filled with this category as parent and its `kind` - used
   * by the "add sub-category" affordance on each parent row in
   * categories.html so the user doesn't have to re-pick the parent from
   * the dropdown.
   */
  readonly presetParent = input<Category | undefined>(undefined);
  readonly saved = output<Category>();

  protected readonly saving = signal(false);
  protected readonly saveErrorKey = signal<string | null>(null);
  protected readonly iconPickerOpen = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    kind: ['expense' as CategoryKind, Validators.required],
    parentId: [''],
    color: [DEFAULT_COLOR, Validators.required],
    icon: [DEFAULT_ICON as Category['icon'], Validators.required]
  });

  private readonly selectedKind = toSignal(this.form.controls.kind.valueChanges, {
    initialValue: this.form.controls.kind.value
  });

  protected readonly selectedIcon = toSignal(this.form.controls.icon.valueChanges, {
    initialValue: this.form.controls.icon.value
  });

  /** True while creating a sub-category via the preset-parent shortcut - the kind picker is locked to the parent's kind. */
  protected readonly kindLocked = computed(() => !this.category() && this.presetParent() !== undefined);

  protected readonly parentOptions = computed(() => {
    const editingId = this.category()?.id;
    return this.allCategories().filter(
      (c) => !c.archived && !c.parentId && c.kind === this.selectedKind() && c.id !== editingId
    );
  });

  /**
   * titleKey/saveErrorKey hold these as plain string literals, only ever
   * reached through the template's translation call - see
   * account-form-modal.ts / layout/sidebar.ts for why that needs this
   * JSDoc "dynamic markings" block:
   * t(categories.form.editTitle, categories.form.newTitle, categories.form.saveError)
   */
  protected readonly titleKey = computed(() =>
    this.category() ? 'categories.form.editTitle' : 'categories.form.newTitle'
  );

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const category = this.category();
      const preset = category ? undefined : this.presetParent();
      this.form.reset({
        name: category?.name ?? '',
        kind: category?.kind ?? preset?.kind ?? 'expense',
        parentId: category?.parentId ?? preset?.id ?? '',
        color: category?.color ?? DEFAULT_COLOR,
        icon: category?.icon ?? DEFAULT_ICON
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
    const payload: Omit<Category, 'id' | 'position'> = {
      name: raw.name.trim(),
      kind: raw.kind,
      parentId: raw.parentId || undefined,
      color: raw.color,
      icon: raw.icon,
      archived: this.category()?.archived ?? false
    };

    this.saving.set(true);
    const existing = this.category();
    const request$ = existing
      ? this.categories.update(existing.id, payload)
      : this.categories.create(payload);

    request$.subscribe({
      next: (category) => {
        this.saving.set(false);
        this.open.set(false);
        this.saved.emit(category);
      },
      error: () => {
        this.saving.set(false);
        this.saveErrorKey.set('categories.form.saveError');
      }
    });
  }
}
