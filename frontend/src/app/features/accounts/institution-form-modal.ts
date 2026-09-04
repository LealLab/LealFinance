import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { ApiError } from '../../core/api-error';
import { ConfirmService } from '../../core/confirm.service';
import { InstitutionRepository } from '../../data/institution.repository';
import { Institution } from '../../domain/models/institution';
import { Button } from '../../shared/ui/button/button';
import { ColorPicker } from '../../shared/ui/color-picker/color-picker';
import { Icon } from '../../shared/ui/icon/icon';
import { IconPicker } from '../../shared/ui/icon-picker/icon-picker';
import { Modal } from '../../shared/ui/modal/modal';

const DEFAULT_COLOR = '#1F5C6B';
const DEFAULT_ICON = 'bank';

/**
 * Create/edit form for an Institution - the grouping layer above Accounts
 * (see domain/models/institution.ts). Structurally mirrors
 * category-form-modal.ts: one instance is reused by the Accounts screen
 * for both "new" (institution undefined) and "edit", and the form
 * repopulates whenever the modal opens.
 *
 * Also offers deletion from the edit view, including detaching or cascading
 * references before deleting the institution.
 */
@Component({
  selector: 'app-institution-form-modal',
  imports: [ReactiveFormsModule, TranslocoDirective, Modal, Button, ColorPicker, Icon, IconPicker],
  templateUrl: './institution-form-modal.html',
})
export class InstitutionFormModal {
  private readonly institutions = inject(InstitutionRepository);
  private readonly confirmService = inject(ConfirmService);
  private readonly fb = inject(FormBuilder);

  readonly open = model.required<boolean>();
  readonly institution = input<Institution | undefined>(undefined);
  /** Used only to compute a new institution's trailing `position`. */
  readonly existingInstitutions = input<Institution[]>([]);
  readonly saved = output<Institution>();
  readonly deleted = output<void>();

  protected readonly saving = signal(false);
  protected readonly deleting = signal(false);
  protected readonly saveErrorKey = signal<string | null>(null);
  protected readonly deleteErrorKey = signal<string | null>(null);
  protected readonly iconPickerOpen = signal(false);
  protected readonly colorPickerOpen = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    icon: [DEFAULT_ICON as Institution['icon'], Validators.required],
    color: [DEFAULT_COLOR]
  });

  protected readonly selectedIcon = toSignal(this.form.controls.icon.valueChanges, {
    initialValue: this.form.controls.icon.value
  });

  protected readonly selectedColor = toSignal(this.form.controls.color.valueChanges, {
    initialValue: this.form.controls.color.value
  });

  /**
   * titleKey/saveErrorKey/deleteErrorKey below hold these as plain string
   * literals, only ever reached through the template's translation call -
   * see account-form-modal.ts for why that needs this JSDoc "dynamic
   * markings" block:
   * t(institutions.form.editTitle, institutions.form.newTitle, institutions.form.saveError, institutions.form.deleteInUseError, institutions.delete.title, institutions.delete.message, institutions.delete.unlinkAndDelete, institutions.delete.cascade)
   */
  protected readonly titleKey = computed(() =>
    this.institution() ? 'institutions.form.editTitle' : 'institutions.form.newTitle'
  );

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const institution = this.institution();
      this.form.reset({
        name: institution?.name ?? '',
        icon: institution?.icon ?? DEFAULT_ICON,
        color: institution?.color ?? DEFAULT_COLOR
      });
      this.saveErrorKey.set(null);
      this.deleteErrorKey.set(null);
    });
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    const existing = this.institution();
    const payload: Omit<Institution, 'id'> = {
      name: raw.name.trim(),
      icon: raw.icon,
      color: raw.color || undefined,
      archived: existing?.archived ?? false,
      position: existing?.position ?? this.existingInstitutions().length
    };

    this.saving.set(true);
    const request$ = existing
      ? this.institutions.update(existing.id, payload)
      : this.institutions.create(payload);

    request$.subscribe({
      next: (institution) => {
        this.saving.set(false);
        this.open.set(false);
        this.saved.emit(institution);
      },
      error: () => {
        this.saving.set(false);
        this.saveErrorKey.set('institutions.form.saveError');
      }
    });
  }

  protected async deleteInstitution(): Promise<void> {
    const existing = this.institution();
    if (!existing) return;

    const choice = await this.confirmService.choose(
      'institutions.delete.title',
      'institutions.delete.message',
      [
        { labelKey: 'institutions.delete.unlinkAndDelete', value: 'detach' },
        { labelKey: 'institutions.delete.cascade', value: 'cascade', tone: 'danger' },
      ],
      {},
    );
    const mode = choice === 'detach' || choice === 'cascade' ? choice : null;
    if (!mode) return;

    this.deleting.set(true);
    this.institutions.delete(existing.id, mode).subscribe({
      next: () => {
        this.deleting.set(false);
        this.open.set(false);
        this.deleted.emit();
      },
      error: (error: unknown) => {
        this.deleting.set(false);
        this.deleteErrorKey.set(
          error instanceof ApiError && error.code === 'institution.has_accounts'
            ? 'institutions.form.deleteInUseError'
            : 'institutions.form.saveError'
        );
      },
    });
  }
}
