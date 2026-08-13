import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { CategoryRepository } from '../../data/category.repository';
import { Category, CategoryKind } from '../../domain/models/category';
import { Button } from '../../shared/ui/button/button';
import { Modal } from '../../shared/ui/modal/modal';
import { CATEGORY_ICON_OPTIONS } from './category-icon-options';

const DEFAULT_COLOR = '#1F5C6B';

/**
 * Create/edit form for a Category. `parentOptions` is restricted to
 * top-level categories of the same kind — categories nest one level deep
 * (see the Category model), so a child can't itself have children, and a
 * category can't become its own parent.
 */
@Component({
  selector: 'app-category-form-modal',
  imports: [ReactiveFormsModule, TranslocoDirective, Modal, Button],
  templateUrl: './category-form-modal.html',
  styleUrl: './category-form-modal.scss'
})
export class CategoryFormModal {
  private readonly categories = inject(CategoryRepository);
  private readonly fb = inject(FormBuilder);

  readonly open = model.required<boolean>();
  readonly category = input<Category | undefined>(undefined);
  readonly allCategories = input.required<Category[]>();
  readonly saved = output<Category>();

  protected readonly iconOptions = CATEGORY_ICON_OPTIONS;
  protected readonly saving = signal(false);
  protected readonly saveErrorKey = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    kind: ['expense' as CategoryKind, Validators.required],
    parentId: [''],
    color: [DEFAULT_COLOR, Validators.required],
    icon: [CATEGORY_ICON_OPTIONS[0], Validators.required]
  });

  private readonly selectedKind = toSignal(this.form.controls.kind.valueChanges, {
    initialValue: this.form.controls.kind.value
  });

  protected readonly parentOptions = computed(() => {
    const editingId = this.category()?.id;
    return this.allCategories().filter(
      (c) => !c.archived && !c.parentId && c.kind === this.selectedKind() && c.id !== editingId
    );
  });

  /**
   * titleKey/saveErrorKey hold these as plain string literals, only ever
   * reached through the template's translation call — see
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
      this.form.reset({
        name: category?.name ?? '',
        kind: category?.kind ?? 'expense',
        parentId: category?.parentId ?? '',
        color: category?.color ?? DEFAULT_COLOR,
        icon: category?.icon ?? CATEGORY_ICON_OPTIONS[0]
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
    const payload: Omit<Category, 'id'> = {
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
