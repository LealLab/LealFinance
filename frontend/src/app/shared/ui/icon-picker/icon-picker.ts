import { Component, computed, inject, input, model, output, signal } from '@angular/core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { Icon, ICON_NAMES, IconName } from '../icon/icon';
import { Modal } from '../modal/modal';

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * Modal grid over the full `ICON_NAMES` set, filterable by a search box, for
 * any form field that currently stores an `IconName` (category icon,
 * institution icon, ...). Reuses `Modal` rather than being one itself, so it
 * stacks correctly when opened from a form that's already inside one - the
 * native `<dialog>` top layer and Escape-closes-topmost behavior handle the
 * nesting without extra code.
 *
 * Usage: `<app-icon-picker [(open)]="iconPickerOpen" [selected]="icon()" (picked)="form.controls.icon.setValue($event)" />`
 */
@Component({
  selector: 'app-icon-picker',
  imports: [Icon, Modal, TranslocoDirective],
  templateUrl: './icon-picker.html',
  styleUrl: './icon-picker.scss'
})
export class IconPicker {
  private readonly transloco = inject(TranslocoService);

  readonly open = model.required<boolean>();
  readonly selected = input.required<IconName>();
  readonly picked = output<IconName>();

  protected readonly query = signal('');

  protected readonly filtered = computed(() => {
    const needle = normalize(this.query());
    if (!needle) return ICON_NAMES;
    return ICON_NAMES.filter((name) => {
      const label = this.transloco.translate(`icons.names.${name}`);
      return normalize(name).includes(needle) || normalize(label).includes(needle);
    });
  });

  protected pick(name: IconName): void {
    this.picked.emit(name);
    this.open.set(false);
  }
}
